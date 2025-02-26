class MyAudioRealtimeElement extends HTMLElement {
  static get observedAttributes() {
    return ['data-api-endpoint', 'data-model-id'];
  }

  constructor() {
    super();
    this.ephemeralKeyFunction = null;
    this.apiEndpoint = "https://api.openai.com/v1/realtime"; // default endpoint
    this.modelId = "gpt-4o-realtime-preview-2024-12-17";       // default model
    this.localStream = null; // will hold the audio stream
    this.pc = null;        // RTCPeerConnection instance
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'data-api-endpoint') {
      this.apiEndpoint = newValue;
    } else if (name === 'data-model-id') {
      this.modelId = newValue;
    }
  }

  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      background: rgba(255, 255, 255, 0.8);
      border-radius: 12px;
      font-family: "Wix Madefor Text", sans-serif;
      box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
    }

    button {
      width: 200px;
      height: 50px;
      background-color: #FFFFFF;
      color: #1010AD;
      border: 2px solid #1010AD;
      border-radius: 12px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.3s ease;
      margin: 10px;
      font-family: "Wix Madefor Text", sans-serif;
    }

    button:hover {
      background-color: #1010AD;
      color: #FFFFFF;
    }

    #err {
      color: red;
      margin-top: 10px;
      font-size: 14px;
    }

    .log, #transcript {
      max-height: 6em;
      overflow: auto;
      font-size: 0.8em;
      background: #eee;
      padding: 4px;
      margin-top: 10px;
    }
  </style>

  <div>
    <button id="connectBtn">Start Conversation</button>
    <button id="muteBtn">Mute Conversation</button>
    <button id="cancelBtn">End Conversation</button>
  </div>

  <div id="err"></div>
  <div class="log" id="logArea"></div>
  <div id="transcript"></div>
`;
    
    const connectBtn = this.shadowRoot.querySelector('#connectBtn');
    connectBtn.addEventListener('click', () => this.handleClick());

    const muteBtn = this.shadowRoot.querySelector('#muteBtn');
    muteBtn.addEventListener('click', () => this.toggleMute(muteBtn));

    const cancelBtn = this.shadowRoot.querySelector('#cancelBtn');
    cancelBtn.addEventListener('click', () => this.cancelChat());
  }

  // Allow injection of an ephemeral key function from the parent (if desired).
  setEphemeralKeyFunction(fn) {
    if (typeof fn === 'function') {
      this.ephemeralKeyFunction = fn;
      console.log("Ephemeral key function injected.");
    } else {
      console.error("Provided ephemeral key function is not a function.");
    }
  }

  // The button click handler: first capture audio, then start the RTC handshake.
  async handleClick() {
    const errEl = this.shadowRoot.querySelector('#err');
    errEl.textContent = '';
    try {
      await this.getAudioAccess();
      await this.startRealtime();
    } catch (err) {
      errEl.textContent = `Error: ${err.message}`;
      console.error(err);
    }
  }

  // Function to capture local audio.
  async getAudioAccess() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    const errEl = this.shadowRoot.querySelector('#err');

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.localStream = stream;
        logEl.textContent += 'Got audio stream successfully.\n';
        // Attach an audio element so the user can hear their input.
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = stream;
        this.shadowRoot.appendChild(audioEl);
      } catch (err) {
        errEl.textContent = 'Error accessing audio: ' + err.message;
        throw err;
      }
    } else {
      const msg = 'navigator.mediaDevices.getUserMedia is not supported in this environment.';
      errEl.textContent = msg;
      throw new Error(msg);
    }
  }

  // Main function to set up the RealTime connection.
  async startRealtime() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    const errEl = this.shadowRoot.querySelector('#err');

    try {
      if (!this.localStream) {
        throw new Error("Audio stream not available.");
      }
      // Retrieve ephemeral key concurrently.
      const ephemeralData = await this.requestEphemeralKey();
      if (ephemeralData.error) {
        errEl.textContent = `Failed ephemeral key: ${ephemeralData.error}`;
        return;
      }
      const ephemeralKey = ephemeralData.client_secret.value;
      logEl.textContent += 'Got ephemeral key\n';

      // Create RTCPeerConnection.
      this.pc = new RTCPeerConnection();
      this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

      // Handle remote track (model’s audio).
      this.pc.ontrack = (event) => {
        logEl.textContent += 'Received remote track from model\n';
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        this.shadowRoot.appendChild(audioEl);
      };

      // Create a data channel for events.
      const dc = this.pc.createDataChannel("oai-events");
      dc.onopen = () => logEl.textContent += 'Data channel open with AI\n';
      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          logEl.textContent += `Data channel event: ${event.type}\n`;
          if (event.type === "response.text.delta" && event.delta) {
            this.updateTranscript(event.delta);
          }
        } catch (err) {
          logEl.textContent += 'Received non-JSON message: ' + e.data + '\n';
        }
      };

      // Create SDP offer.
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      logEl.textContent += 'Created SDP offer\n';

      // Send the offer to OpenAI Realtime using the ephemeral key.
      const sdpResponse = await fetch(`${this.apiEndpoint}?model=${this.modelId}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });
      if (!sdpResponse.ok) {
        errEl.textContent = `Failed to get answer SDP: ${sdpResponse.status} - ${sdpResponse.statusText}`;
        return;
      }
      const answerSdp = await sdpResponse.text();
      logEl.textContent += 'Received answer SDP\n';

      // Set the remote description.
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      logEl.textContent += 'Connected to OpenAI Realtime!\n';
    } catch (err) {
      errEl.textContent = `Realtime error: ${err.name} - ${err.message}`;
      console.error(err);
    }
  }

  // Retrieve the ephemeral key using an injected function or a fallback HTTP call.
  async requestEphemeralKey() {
  if (this.ephemeralKeyFunction) {
    return await this.ephemeralKeyFunction();
  }
  // Use the standard Wix HTTP function endpoint format.
  const response = await fetch('https://www.backagain.io/_functions/get_ephemeralKey', {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.statusText}`);
  }
  return await response.json();
}

  // Append transcription text to the transcript display.
  updateTranscript(text) {
    let transcriptEl = this.shadowRoot.querySelector('#transcript');
    if (!transcriptEl) {
      transcriptEl = document.createElement('div');
      transcriptEl.id = 'transcript';
      transcriptEl.style.marginTop = '10px';
      transcriptEl.style.padding = '4px';
      transcriptEl.style.background = '#f0f0f0';
      this.shadowRoot.appendChild(transcriptEl);
    }
    transcriptEl.textContent += text;
  }

  // Toggle mute/unmute for the local audio stream.
  toggleMute(button) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        button.textContent = track.enabled ? "Mute" : "Unmute";
      });
    }
  }

  // Cancel the current chat: stop local audio and close the RTCPeerConnection.
  cancelChat() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
      logEl.textContent += 'Audio stream canceled.\n';
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
      logEl.textContent += 'RTCPeerConnection closed.\n';
    }
  }
}

customElements.define('my-audio-rt-element', MyAudioRealtimeElement);




