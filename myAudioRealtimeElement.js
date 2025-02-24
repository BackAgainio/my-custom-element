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
        button { margin-bottom: 0.5em; }
        #err { color: red; }
        .log { max-height: 6em; overflow: auto; font-size: 0.8em; background: #eee; padding: 4px; }
      </style>
      <button id="connectBtn">Connect &amp; Stream to OpenAI</button>
      <div id="err"></div>
      <div class="log" id="logArea"></div>
    `;
    
    // Attach a click listener that triggers audio capture first,
    // then proceeds with RealTime connection.
    const btn = this.shadowRoot.querySelector('#connectBtn');
    btn.addEventListener('click', () => this.handleClick());
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

  // The button click handler: first get audio permission, then connect.
  async handleClick() {
    try {
      // 1. Capture audio immediately to trigger the permission prompt.
      await this.getAudioAccess();
      // 2. Once audio is captured, proceed with the RTC handshake.
      await this.startRealtime();
    } catch (err) {
      const errEl = this.shadowRoot.querySelector('#err');
      errEl.textContent = `Error: ${err.message}`;
      console.error(err);
    }
  }

  // Function to capture local audio (same as your proven simple code).
  async getAudioAccess() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    const errEl = this.shadowRoot.querySelector('#err');

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.localStream = stream;
        logEl.textContent += 'Got audio stream successfully.\n';
        // Optionally attach an audio element so the user can hear the input.
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
      // Ensure we have a local audio stream.
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
      const pc = new RTCPeerConnection();
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

      // When receiving remote audio, attach it.
      pc.ontrack = (event) => {
        logEl.textContent += 'Received remote track from model\n';
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        this.shadowRoot.appendChild(audioEl);
      };

      // Create data channel (optional).
      const dc = pc.createDataChannel("oai-events");
      dc.onopen = () => logEl.textContent += 'Data channel open with AI\n';
      dc.onmessage = (e) => logEl.textContent += 'AI event: ' + e.data + '\n';

      // Create SDP offer.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
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
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      logEl.textContent += 'Connected to OpenAI Realtime!\n';
    } catch (err) {
      errEl.textContent = `Realtime error: ${err.name} - ${err.message}`;
      console.error(err);
    }
  }

  // Retrieve the ephemeral key using the injected function, or a fallback HTTP call.
  async requestEphemeralKey() {
    if (this.ephemeralKeyFunction) {
      return await this.ephemeralKeyFunction();
    }
    // Fallback: call an HTTP endpoint for the ephemeral key.
    const response = await fetch('https://www.backagain.io/_functions/get_ephemeralKey');
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.statusText}`);
    }
    return await response.json();
  }
}

customElements.define('my-audio-rt-element', MyAudioRealtimeElement);


