/* Eruption Scout — draw QR codes and read them with the camera. */
(function (root) {
  function svg(text) {
    root.qrcode.stringToBytes = root.qrcode.stringToBytesFuncs["UTF-8"];
    const q = root.qrcode(0, "L");
    q.addData(text, "Byte");
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }

  /** Starts the camera in <video>, calls onText(text) for every code seen. Returns stop(). */
  async function startScanner(video, onText, onError) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onError("This browser can't use the camera here. Use the app from its https:// link.");
      return () => {};
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      onError("Camera blocked or not found. Allow camera access for this site and try again.");
      return () => {};
    }
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    await video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let alive = true, last = "";
    const tick = () => {
      if (!alive) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const scale = Math.min(1, 960 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hit = root.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (hit && hit.data && hit.data !== last) { last = hit.data; onText(hit.data); }
      }
      setTimeout(() => requestAnimationFrame(tick), 120);
    };
    tick();
    return () => { alive = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  }

  root.ESQR = { svg, startScanner };
})(typeof self !== "undefined" ? self : globalThis);
