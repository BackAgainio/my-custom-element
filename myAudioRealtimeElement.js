// myAudioRealtimeElement.js

class MyAudioRealtimeElement extends HTMLElement {
  constructor() {
    super();
    // We'll store the ephemeral key function here.
    this.ephemeralKeyFunction = null;
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

  // Method for the parent to inject the ephemeral key function.
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
      // 1) Request ephemeral key using the injected function.
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
      const baseUrl = "https://api.openai.com/v1/realtime";
      const modelId = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${modelId}`, {
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
    return await this.ephemeralKeyFunction();
  }
}

// Register the element
customElements.define('my-audio-rt-element', MyAudioRealtimeElement);
