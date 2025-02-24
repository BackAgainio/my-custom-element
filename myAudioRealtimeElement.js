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
      // First, request audio access
      this.getAudioAccess();
      // Then, send a message to the parent to request the ephemeral key
      window.parent.postMessage({ type: 'REQUEST_EPHEMERAL_KEY' }, '*');
    });

    // Listen for messages from the parent
    window.addEventListener('message', (event) => {
      // Optionally, check event.origin to ensure it's from your trusted parent
      if (event.data && event.data.type === 'EPHEMERAL_KEY') {
        this.ephemeralKeyData = event.data.key;
        this.startRealtime();
      }
    });
  }

  getAudioAccess() {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        const logEl = this.shadowRoot.querySelector('#logArea');
        logEl.textContent += 'Got audio stream\n';
        // Optionally, attach the stream to an audio element so you can hear it
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = stream;
        this.shadowRoot.appendChild(audioEl);
      })
      .catch(err => {
        const errEl = this.shadowRoot.querySelector('#err');
        errEl.textContent = 'Audio error: ' + err;
        console.error(err);
      });
  }

  async startRealtime() {
    const logEl = this.shadowRoot.querySelector('#logArea');
    const errEl = this.shadowRoot.querySelector('#err');
    
    if (!this.ephemeralKeyData) {
      errEl.textContent = 'Ephemeral key data not received';
      return;
    }
    
    logEl.textContent += 'Received ephemeral key, now starting RTC...\n';
    
    try {
      // Create RTCPeerConnection
      const pc = new RTCPeerConnection();

      // (Assume audio is already captured; you'll want to add the audio tracks accordingly.)
      // For this example, we assume getAudioAccess() already ran and attached the stream.

      // For demonstration, re-request the audio (in a real app, reuse the captured stream)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      logEl.textContent += 'Re-added audio track\n';

      // Handle remote track from the model:
      pc.ontrack = (event) => {
        logEl.textContent += 'Received remote track from model\n';
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        this.shadowRoot.appendChild(audioEl);
      };

      // Create a data channel (optional)
      const dc = pc.createDataChannel("oai-events");
      dc.onopen = () => logEl.textContent += 'Data channel open with AI\n';
      dc.onmessage = (e) => {
        logEl.textContent += 'AI event: ' + e.data + '\n';
      };

      // Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logEl.textContent += 'Created SDP offer\n';

      // Send the offer to OpenAI Realtime using the ephemeral key:
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
        errEl.textContent = `Failed to get answer SDP: ${sdpResponse.status} - ${sdpResponse.statusText}`;
        return;
      }
      const answerSdp = await sdpResponse.text();
      logEl.textContent += 'Received answer SDP\n';

      // Set remote description
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      logEl.textContent += 'Connected to OpenAI Realtime!\n';

    } catch (err) {
      errEl.textContent = `Realtime error: ${err.name} - ${err.message}`;
      console.error(err);
    }
  }
}

customElements.define('my-audio-rt-element', MyAudioRealtimeElement);

