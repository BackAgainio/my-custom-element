class MyAudioRealtimeElement extends HTMLElement {
  static get observedAttributes() {
    return ['data-api-endpoint', 'data-model-id'];
  }

  constructor() {
    super();
    this.ephemeralKeyFunction = null;
    this.apiEndpoint = "https://api.openai.com/v1/realtime"; // default
    this.modelId = "gpt-4o-realtime-preview-2024-12-17";       // default
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
    
    const btn = this.shadowRoot.querySelector('#connectBtn');
    btn.addEventListener('click', () => this.startRealtime());
  }

  // ... (rest of your code remains the same, but when making the API call, use this.apiEndpoint and this.modelId)
  
  async startRealtime() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    const errEl = this.shadowRoot.querySelector('#err');

    try {
      if (!this.ephemeralKeyFunction) {
        throw new Error("Ephemeral key function is not set on this element.");
      }
      const ephemeralData = await this.ephemeralKeyFunction();
      if (ephemeralData.error) {
        errEl.textContent = `Failed ephemeral key: ${ephemeralData.error}`;
        return;
      }
      const ephemeralKey = ephemeralData.client_secret.value;
      logEl.textContent += 'Got ephemeral key\n';

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      logEl.textContent += 'Got user audio stream\n';

      const pc = new RTCPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.ontrack = (event) => {
        logEl.textContent += 'Received remote track from model\n';
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        this.shadowRoot.appendChild(audioEl);
      };

      const dc = pc.createDataChannel("oai-events");
      dc.onopen = () => logEl.textContent += 'Data channel open with AI\n';
      dc.onmessage = (e) => {
        logEl.textContent += 'AI event: ' + e.data + '\n';
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logEl.textContent += 'Created SDP offer\n';

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

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      logEl.textContent += 'Connected to OpenAI Realtime!\n';
    } catch (err) {
      errEl.textContent = `Realtime error: ${err.name} - ${err.message}`;
      console.error(err);
    }
  }

  async requestEphemeralKey() {
    return await this.ephemeralKeyFunction();
  }
}

customElements.define('my-audio-rt-element', MyAudioRealtimeElement);



