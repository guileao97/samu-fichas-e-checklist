/* ============================================================================
 * SAMU 192 – ORLÂNDIA-SP | CAPTURA DE ASSINATURA NA TELA (TOQUE / CANETA)
 * ============================================================================ */

(function() {
  const SIG_INK_BLUE = '#1248c4';
  const SIG_INK_RGB = [18, 72, 196];

  let modalEl = null;
  let canvas = null;
  let ctx = null;
  let isDrawing = false;
  let hasStrokes = false;
  let points = [];
  let currentCallback = null;
  let currentOpts = {};

  function tintCanvasPixelsToBlue(targetCanvas) {
    if (!targetCanvas || !targetCanvas.width || !targetCanvas.height) return false;
    const tctx = targetCanvas.getContext('2d');
    let changed = false;
    try {
      const imgData = tctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
      const px = imgData.data;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        if (a < 10) continue;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (a > 240 && lum > 242) {
          px[i + 3] = 0;
          changed = true;
        } else if (px[i] !== SIG_INK_RGB[0] || px[i + 1] !== SIG_INK_RGB[1] || px[i + 2] !== SIG_INK_RGB[2]) {
          px[i] = SIG_INK_RGB[0];
          px[i + 1] = SIG_INK_RGB[1];
          px[i + 2] = SIG_INK_RGB[2];
          changed = true;
        }
      }
      if (changed) tctx.putImageData(imgData, 0, 0);
    } catch (e) {
      tctx.save();
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = SIG_INK_BLUE;
      tctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
      tctx.restore();
      changed = true;
    }
    return changed;
  }

  function tintDataUrlToBlueInk(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return Promise.resolve(dataUrl || '');
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (!img.width || !img.height) {
          resolve(dataUrl);
          return;
        }
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(img, 0, 0);
        try {
          const px = tctx.getImageData(0, 0, tmp.width, tmp.height).data;
          let needsRecolor = false;
          for (let i = 0; i < px.length; i += 16) {
            const a = px[i + 3];
            if (a > 110) {
              if (Math.abs(px[i] - SIG_INK_RGB[0]) > 14 || Math.abs(px[i + 1] - SIG_INK_RGB[1]) > 18 || px[i + 2] < 165) {
                needsRecolor = true;
                break;
              }
            }
          }
          if (!needsRecolor) {
            resolve(dataUrl);
            return;
          }
        } catch (e) {}
        tintCanvasPixelsToBlue(tmp);
        resolve(tmp.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function ensureModal() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.id = 'samu-sig-modal';
    modalEl.className = 'sig-modal hidden';
    modalEl.innerHTML = `
      <div class="sig-modal-card">
        <div class="sig-modal-header">
          <div>
            <h3 id="sig-modal-title">Assinatura</h3>
            <p id="sig-modal-subtitle">Assine com o dedo ou caneta no quadro abaixo</p>
          </div>
          <button type="button" class="btn-icon-close" id="sig-btn-cancel" aria-label="Fechar">&times;</button>
        </div>
        <div class="sig-canvas-wrap">
          <canvas id="sig-pad-canvas"></canvas>
          <div class="sig-baseline"><span>Assine acima da linha</span></div>
        </div>
        <div class="sig-personal-row hidden" id="sig-personal-row">
          <button type="button" class="btn btn-outline btn-sm" id="sig-btn-load-saved">Usar minha assinatura salva</button>
          <label class="sig-save-default-lbl">
            <input type="checkbox" id="sig-chk-save-default">
            <span>Salvar como minha assinatura padrão neste aparelho</span>
          </label>
        </div>
        <div class="sig-modal-footer">
          <button type="button" class="btn btn-secondary" id="sig-btn-clear">Limpar</button>
          <div class="sig-footer-right">
            <button type="button" class="btn btn-outline" id="sig-btn-remove">Remover Assinatura</button>
            <button type="button" class="btn btn-primary" id="sig-btn-confirm">Confirmar Assinatura</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    canvas = document.getElementById('sig-pad-canvas');
    ctx = canvas.getContext('2d');

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      let clientX, clientY;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      isDrawing = true;
      hasStrokes = true;
      const p = getPos(e);
      points = [p];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = SIG_INK_BLUE;
      ctx.fill();
    };

    const moveDraw = (e) => {
      if (!isDrawing) return;
      e.preventDefault();
      const p = getPos(e);
      points.push(p);

      ctx.strokeStyle = SIG_INK_BLUE;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (points.length < 3) {
        const b = points[0];
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        return;
      }

      const len = points.length;
      const p1 = points[len - 3];
      const p2 = points[len - 2];
      const p3 = points[len - 1];
      const mid1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const mid2 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };

      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(p2.x, p2.y, mid2.x, mid2.y);
      ctx.stroke();
    };

    const endDraw = (e) => {
      if (!isDrawing) return;
      if (e) e.preventDefault();
      isDrawing = false;
      points = [];
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw, { passive: false });

    document.getElementById('sig-btn-clear').addEventListener('click', clearPad);
    document.getElementById('sig-btn-cancel').addEventListener('click', closeModal);

    document.getElementById('sig-btn-remove').addEventListener('click', () => {
      const cb = currentCallback;
      closeModal();
      if (cb) cb('');
    });

    document.getElementById('sig-btn-load-saved').addEventListener('click', () => {
      if (!currentOpts.username) return;
      const saved = window.SamuStorage.getSavedSignature(currentOpts.username);
      if (saved) {
        drawDataUrlOnCanvas(saved);
      }
    });

    document.getElementById('sig-btn-confirm').addEventListener('click', () => {
      if (!hasStrokes) {
        alert('Desenhe a assinatura no quadro antes de confirmar (ou toque em Remover Assinatura).');
        return;
      }
      const dataUrl = exportTrimmedSignature();
      const saveChk = document.getElementById('sig-chk-save-default');
      if (currentOpts.allowPersonalSave && currentOpts.username && saveChk && saveChk.checked && dataUrl) {
        window.SamuStorage.savePersonalSignature(currentOpts.username, dataUrl);
      }
      const cb = currentCallback;
      closeModal();
      if (cb) cb(dataUrl);
    });
  }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const w = Math.max(rect.width, 300);
    const h = Math.max(rect.height, 200);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
  }

  function clearPad() {
    if (!canvas || !ctx) return;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    hasStrokes = false;
    points = [];
  }

  function drawDataUrlOnCanvas(dataUrl) {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      clearPad();
      const dpr = Math.max(window.devicePixelRatio || 1, 2);
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const scale = Math.min((cw * 0.8) / img.width, (ch * 0.75) / img.height, 1.5);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      tintCanvasPixelsToBlue(canvas);
      hasStrokes = true;
    };
    img.src = dataUrl;
  }

  function exportTrimmedSignature() {
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let found = false;

    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const alpha = imgData[(y * w + x) * 4 + 3];
        if (alpha > 15) {
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found) {
      tintCanvasPixelsToBlue(canvas);
      return canvas.toDataURL('image/png');
    }
    const pad = 16;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);

    const tw = Math.max(40, maxX - minX + 1);
    const th = Math.max(25, maxY - minY + 1);
    const tmp = document.createElement('canvas');
    tmp.width = tw;
    tmp.height = th;
    tmp.getContext('2d').drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th);
    tintCanvasPixelsToBlue(tmp);
    return tmp.toDataURL('image/png');
  }

  function openSignaturePad(options, callback) {
    ensureModal();
    currentOpts = options || {};
    currentCallback = callback;

    document.getElementById('sig-modal-title').textContent = currentOpts.title || 'Coletar Assinatura';
    document.getElementById('sig-modal-subtitle').textContent = currentOpts.subtitle || 'Assine com o dedo ou caneta no quadro abaixo';

    const personalRow = document.getElementById('sig-personal-row');
    const loadSavedBtn = document.getElementById('sig-btn-load-saved');
    const saveChk = document.getElementById('sig-chk-save-default');
    if (saveChk) saveChk.checked = false;

    if (currentOpts.allowPersonalSave && currentOpts.username) {
      personalRow.classList.remove('hidden');
      const saved = window.SamuStorage.getSavedSignature(currentOpts.username);
      loadSavedBtn.style.display = saved ? 'inline-flex' : 'none';
    } else {
      personalRow.classList.add('hidden');
    }

    modalEl.classList.remove('hidden');
    requestAnimationFrame(() => {
      resizeCanvas();
      if (currentOpts.initialValue) {
        drawDataUrlOnCanvas(currentOpts.initialValue);
      } else {
        clearPad();
      }
    });
  }

  function closeModal() {
    if (modalEl) modalEl.classList.add('hidden');
    currentCallback = null;
  }

  window.SamuSignature = {
    open: openSignaturePad,
    tintDataUrlBlue: tintDataUrlToBlueInk
  };
})();
