class MyAudioRealtimeElement extends HTMLElement {
  static get observedAttributes() {
    return ['data-api-endpoint', 'data-model-id'];
  }

  constructor() {
    super();
    this.ephemeralKeyFunction = null;
    this.apiEndpoint = "https://api.openai.com/v1/realtime"; // default endpoint
    this.modelId = "gpt-4o-realtime-preview-2024-12-17";       // default model
    this.localStream = null; // will hold the captured audio stream
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
    // Template for the element's UI: connect button, mute/unmute, cancel, transcript, log and error areas.
    this.shadowRoot.innerHTML = `
      <style>
        button { margin-bottom: 0.5em; margin-right: 0.5em; }
        #err { color: red; margin-top: 0.5em; }
        .log, #transcript { max-height: 6em; overflow: auto; font-size: 0.8em; background: #eee; padding: 4px; margin-top: 0.5em; }
      </style>
      <div>
        <button id="connectBtn">Connect &amp; Stream to OpenAI</button>
        <button id="muteBtn">Mute</button>
        <button id="cancelBtn">Cancel Chat</button>
      </div>
      <div id="err"></div>
      <div class="log" id="logArea"></div>
      <div id="transcript" style="margin-top:10px;"></div>
    `;
    
    // Set up event listeners.
    const connectBtn = this.shadowRoot.querySelector('#connectBtn');
    connectBtn.addEventListener('click', () => this.handleClick());
    
    const muteBtn = this.shadowRoot.querySelector('#muteBtn');
    muteBtn.addEventListener('click', () => this.toggleMute(muteBtn));
    
    const cancelBtn = this.shadowRoot.querySelector('#cancelBtn');
    cancelBtn.addEventListener('click', () => this.cancelChat());
  }

  // Allow injection of an ephemeral key function (if desired)
  setEphemeralKeyFunction(fn) {
    if (typeof fn === 'function') {
      this.ephemeralKeyFunction = fn;
      console.log("Ephemeral key function injected.");
    } else {
      console.error("Provided ephemeral key function is not a function.");
    }
  }

  // Button click handler: capture audio and initiate connection
  async handleClick() {
    const errEl = this.shadowRoot.querySelector('#err');
    errEl.textContent = '';
    try {
      // 1. Capture audio (this triggers the permission prompt)
      await this.getAudioAccess();
      // 2. Proceed with the RTC handshake
      await this.startRealtime();
    } catch (err) {
      errEl.textContent = `Error: ${err.message}`;
      console.error(err);
    }
  }

  // Capture local audio; works as in your proven code.
  async getAudioAccess() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    const errEl = this.shadowRoot.querySelector('#err');

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.localStream = stream;
        logEl.textContent += 'Got audio stream successfully.\n';
        // Attach an audio element so the user hears their input.
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

  // Set up the RTCPeerConnection and handle the RealTime handshake.
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

      // Create RTCPeerConnection and add local tracks.
      this.pc = new RTCPeerConnection();
      this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

      // Handle remote track (model’s audio)
      this.pc.ontrack = (event) => {
        logEl.textContent += 'Received remote track from model\n';
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        this.shadowRoot.appendChild(audioEl);
      };

      // Set up data channel for events (such as transcriptions)
      const dc = this.pc.createDataChannel("oai-events");
      dc.onopen = () => logEl.textContent += 'Data channel open with AI\n';
      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          logEl.textContent += `Data channel event: ${event.type}\n`;
          // Update transcript if event contains transcription deltas.
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

      // Set remote description.
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      logEl.textContent += 'Connected to OpenAI Realtime!\n';
    } catch (err) {
      errEl.textContent = `Realtime error: ${err.name} - ${err.message}`;
      console.error(err);
    }
  }

  // Retrieves the ephemeral key using an injected function or a fallback HTTP call.
  async requestEphemeralKey() {
    if (this.ephemeralKeyFunction) {
      return await this.ephemeralKeyFunction();
    }
    const response = await fetch('https://www.backagain.io/_functions/get_ephemeralKey');
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.statusText}`);
    }
    return await response.json();
  }

  // Append transcription delta to the transcript display.
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

  // Cancel the current chat: stop the local stream and close the RTCPeerConnection.
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


