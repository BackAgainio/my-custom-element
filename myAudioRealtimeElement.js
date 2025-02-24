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

  // This method allows a parent (if used) to inject an ephemeral key function.
  // For a self-contained approach, you can simply not inject one.
  setEphemeralKeyFunction(fn) {
    if (typeof fn === 'function') {
      this.ephemeralKeyFunction = fn;
      console.log("Ephemeral key function injected.");
    } else {
      console.error("Provided ephemeral key function is not a function.");
    }
  }

  async startRealtime() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    const errEl = this.shadowRoot.querySelector('#err');

    try {
      // 1) Request ephemeral key using the provided function or the fallback.
      const ephemeralData = await this.requestEphemeralKey();
      if (ephemeralData.error) {
        errEl.textContent = `Failed ephemeral key: ${ephemeralData.error}`;
        return;
      }
      const ephemeralKey = ephemeralData.client_secret.value;
      logEl.textContent += 'Got ephemeral key\n';

      // 2) Capture local audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      logEl.textContent += 'Got user audio stream\n';

      // 3) Create RTCPeerConnection
      const pc = new RTCPeerConnection();

      // 4) Add local audio track
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // 5) Handle remote track (model’s audio)
      pc.ontrack = (event) => {
        logEl.textContent += 'Received remote track from model\n';
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        this.shadowRoot.appendChild(audioEl);
      };

      // 6) Create a data channel (optional)
      const dc = pc.createDataChannel("oai-events");
      dc.onopen = () => logEl.textContent += 'Data channel open with AI\n';
      dc.onmessage = (e) => {
        logEl.textContent += 'AI event: ' + e.data + '\n';
      };

      // 7) Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logEl.textContent += 'Created SDP offer\n';

      // 8) Send the offer to OpenAI Realtime using the ephemeral key.
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

      // 9) Set the remote description
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      logEl.textContent += 'Connected to OpenAI Realtime!\n';
    } catch (err) {
      errEl.textContent = `Realtime error: ${err.name} - ${err.message}`;
      console.error(err);
    }
  }

  async requestEphemeralKey() {
    // If a function was injected, use it.
    if (this.ephemeralKeyFunction) {
      return await this.ephemeralKeyFunction();
    }
    // Otherwise, use the fallback: call an HTTP endpoint (which you set up in Wix)
    const response = await fetch('https://www.backagain.io/_functions/get_ephemeralKey');
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.statusText}`);
    }
    return await response.json();
  }
}

customElements.define('my-audio-rt-element', MyAudioRealtimeElement);



