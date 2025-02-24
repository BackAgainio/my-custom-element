class MyAudioRealtimeElement extends HTMLElement {
  constructor() {
    super();
    this.ephemeralKeyData = null;
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
    btn.addEventListener('click', () => {
      // Start audio capture immediately.
      this.getAudioAccess();
      // Send a message to the parent window requesting an ephemeral key.
      window.parent.postMessage({ type: 'REQUEST_EPHEMERAL_KEY' }, '*');
    });

    // Listen for a response from the parent with the ephemeral key.
    window.addEventListener('message', (event) => {
      // Optionally, check event.origin for security.
      if (event.data && event.data.type === 'EPHEMERAL_KEY') {
        this.ephemeralKeyData = event.data.key;
        this.log('Ephemeral key received.');
        this.startRealtime();
      }
    });
  }

  log(msg) {
    const logEl = this.shadowRoot.querySelector('#logArea');
    logEl.textContent += msg + '\n';
  }

  getAudioAccess() {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        this.log('Got audio stream.');
        // Attach audio stream to an audio element so the user can hear it.
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = stream;
        this.shadowRoot.appendChild(audioEl);
        // You might want to store the stream for later use.
        this.localStream = stream;
      })
      .catch(err => {
        const errEl = this.shadowRoot.querySelector('#err');
        errEl.textContent = 'Audio error: ' + err.message;
        console.error(err);
      });
  }

  async startRealtime() {
    if (!this.ephemeralKeyData) {
      const errEl = this.shadowRoot.querySelector('#err');
      errEl.textContent = 'Ephemeral key data not set.';
      return;
    }
    this.log('Starting RealTime connection...');
    try {
      // Create RTCPeerConnection.
      const pc = new RTCPeerConnection();

      // Add local audio track from previously captured stream.
      if (!this.localStream) {
        throw new Error("Local audio stream not available.");
      }
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

      // Handle remote audio.
      pc.ontrack = (event) => {
        this.log('Received remote track from model.');
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        this.shadowRoot.appendChild(audioEl);
      };

      // Create data channel (optional).
      const dc = pc.createDataChannel("oai-events");
      dc.onopen = () => this.log('Data channel open with AI.');
      dc.onmessage = (e) => this.log('AI event: ' + e.data);

      // Create SDP offer.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.log('Created SDP offer.');

      // Send offer to OpenAI Realtime using ephemeral key.
      const baseUrl = "https://api.openai.com/v1/realtime";
      const modelId = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${modelId}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.ephemeralKeyData.client_secret.value}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });
      if (!sdpResponse.ok) {
        const errEl = this.shadowRoot.querySelector('#err');
        errEl.textContent = `Failed to get answer SDP: ${sdpResponse.status} - ${sdpResponse.statusText}`;
        return;
      }
      const answerSdp = await sdpResponse.text();
      this.log('Received answer SDP.');

      // Set remote description.
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      this.log('Connected to OpenAI Realtime!');
    } catch (err) {
      const errEl = this.shadowRoot.querySelector('#err');
      errEl.textContent = `Realtime error: ${err.name} - ${err.message}`;
      console.error(err);
    }
  }
}

customElements.define('my-audio-rt-element', MyAudioRealtimeElement);


