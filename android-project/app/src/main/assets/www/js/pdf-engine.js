/* ============================================================================
 * SAMU 192 – ORLÂNDIA-SP | MOTOR OFFLINE DE RENDERIZAÇÃO A4 E GERADOR DE PDF
 * Gera páginas A4 idênticas aos modelos oficiais (200 DPI) + arquivo .PDF real
 * ============================================================================ */

(function() {
  const INK_BLUE = '#1248c4';
  const INK_RGB = [18, 72, 196];
  const imgCache = {};

  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (imgCache[src]) return Promise.resolve(imgCache[src]);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Não faz cache eterno de assinaturas dinâmicas longas demais, só logos
        if (src.length < 350000) imgCache[src] = img;
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function formatDateBR(dStr) {
    if (!dStr) return '    /    /      ';
    if (/^\d{4}-\d{2}-\d{2}/.test(dStr)) {
      const [y, m, d] = dStr.substring(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }
    return dStr;
  }

  function drawCheckbox(ctx, x, y, size, checked, label, font, opts) {
    ctx.save();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x, y, size, size);
    if (checked) {
      ctx.fillStyle = INK_BLUE;
      ctx.fillRect(x + 3, y + 3, size - 6, size - 6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + size * 0.52);
      ctx.lineTo(x + size * 0.42, y + size - 4);
      ctx.lineTo(x + size - 3.5, y + 4);
      ctx.stroke();
    }
    if (label) {
      ctx.fillStyle = (opts && opts.blueLabel) ? INK_BLUE : '#000000';
      ctx.font = font || '20px Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + size + 8, y + size / 2 + 1);
    }
    ctx.restore();
  }

  function wrapTextLines(ctx, text, maxWidth) {
    if (!text) return [];
    const paragraphs = String(text).split(/\r?\n/);
    const lines = [];
    for (const para of paragraphs) {
      if (!para.trim()) {
        lines.push('');
        continue;
      }
      const words = para.split(/\s+/);
      let current = '';
      for (const word of words) {
        const test = current ? current + ' ' + word : word;
        if (ctx.measureText(test).width <= maxWidth) {
          current = test;
        } else {
          if (current) lines.push(current);
          // Caso uma palavra gigante passe da largura
          if (ctx.measureText(word).width > maxWidth) {
            let chunk = '';
            for (const ch of word) {
              if (ctx.measureText(chunk + ch).width <= maxWidth) chunk += ch;
              else { lines.push(chunk); chunk = ch; }
            }
            current = chunk;
          } else {
            current = word;
          }
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  function drawSignatureFit(ctx, sigImg, x, y, w, h) {
    if (!sigImg || !sigImg.width || !sigImg.height) return;
    const scale = Math.min(w / sigImg.width, h / sigImg.height);
    const dw = Math.max(1, Math.round(sigImg.width * scale));
    const dh = Math.max(1, Math.round(sigImg.height * scale));

    const tmp = document.createElement('canvas');
    tmp.width = dw;
    tmp.height = dh;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(sigImg, 0, 0, dw, dh);
    try {
      const imgData = tctx.getImageData(0, 0, dw, dh);
      const px = imgData.data;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        if (a < 10) continue;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (a > 240 && lum > 242) {
          px[i + 3] = 0;
        } else {
          px[i] = INK_RGB[0];
          px[i + 1] = INK_RGB[1];
          px[i + 2] = INK_RGB[2];
        }
      }
      tctx.putImageData(imgData, 0, 0);
    } catch (e) {
      tctx.save();
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = INK_BLUE;
      tctx.fillRect(0, 0, dw, dh);
      tctx.restore();
    }

    ctx.drawImage(tmp, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function fitText(ctx, text, x, y, maxW, font) {
    if (!text) return;
    ctx.save();
    if (font) ctx.font = font;
    let s = String(text);
    if (ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) {
        s = s.slice(0, -1);
      }
      s += '…';
    }
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  function fillTextInk(ctx, text, x, y, font) {
    if (text === null || text === undefined || text === '') return;
    ctx.save();
    if (font) ctx.font = font;
    ctx.fillStyle = INK_BLUE;
    ctx.fillText(String(text), x, y);
    ctx.restore();
  }

  function fitTextInk(ctx, text, x, y, maxW, font) {
    if (text === null || text === undefined || text === '') return;
    ctx.save();
    if (font) ctx.font = font;
    ctx.fillStyle = INK_BLUE;
    let s = String(text);
    if (ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) {
        s = s.slice(0, -1);
      }
      s += '…';
    }
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  /* ==========================================================================
   * 1. RENDERIZADOR OFICIAL: FICHA DE ATENDIMENTO USB (2 PÁGINAS A4 RETRATO)
   * ========================================================================== */
  async function renderFichaCanvases(d) {
    const assets = window.SAMU_ASSETS || {};
    const [
      samuLogo, orlandiaLogo, burnImg, watermarkImg,
      pupilL, pupilM, pupilS,
      sigTermoImg, sigRecebidoImg, sigEnfImg, sigEnf2Img, sigCondImg, sigCond2Img
    ] = await Promise.all([
      loadImg(assets.samu_logo),
      loadImg(assets.orlandia_logo),
      loadImg(assets.burn_diagram),
      loadImg(assets.samu_watermark),
      loadImg(assets.pupil_large),
      loadImg(assets.pupil_medium),
      loadImg(assets.pupil_small),
      loadImg(d.sigTermo),
      loadImg(d.sigRecebido),
      loadImg(d.sigEnfermagem),
      loadImg(d.sigEnfermagem2),
      loadImg(d.sigCondutor),
      loadImg(d.sigCondutor2)
    ]);

    const W = 1654, H = 2339;
    const M = 52;
    const CW = W - M * 2; // 1550

    // -------------------- PÁGINA 1 (FRENTE) --------------------
    const c1 = document.createElement('canvas');
    c1.width = W; c1.height = H;
    const g = c1.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);

    // Marca d'água central suave igual ao PDF oficial
    if (watermarkImg) {
      g.save();
      g.globalAlpha = 0.08;
      g.drawImage(watermarkImg, 140, 820, 950, 950);
      g.restore();
    }

    g.strokeStyle = '#111111';
    g.fillStyle = '#000000';
    g.lineWidth = 1.8;

    let y = 40;
    // Borda superior do cabeçalho
    g.strokeRect(M, y, CW, 156);
    if (samuLogo) g.drawImage(samuLogo, M + 18, y + 12, 235, 132);
    if (orlandiaLogo) g.drawImage(orlandiaLogo, M + 285, y + 10, 145, 136);

    g.font = 'bold 28px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('SAMU 192 – ORLÂNDIA- SP', M + 740, y + 54);
    g.fillText('FICHA DE ATENDIMENTO', M + 740, y + 90);
    g.fillText('USB', M + 740, y + 126);
    g.textAlign = 'left';

    // Caixa DATA / KM INICIAL / KM FINAL à direita
    const bx = M + 1125, by = y + 20, bw = 385, bh = 114, brh = 38;
    g.strokeRect(bx, by, bw, bh);
    g.beginPath();
    g.moveTo(bx, by + brh); g.lineTo(bx + bw, by + brh);
    g.moveTo(bx, by + brh * 2); g.lineTo(bx + bw, by + brh * 2);
    g.stroke();
    g.font = '21px Arial, sans-serif';
    g.fillText('DATA:', bx + 20, by + 27);
    if (d.data) {
      fillTextInk(g, formatDateBR(d.data), bx + 110, by + 27, 'bold 21px Arial, sans-serif');
    } else {
      g.font = 'bold 21px Arial, sans-serif';
      g.fillText('    /    /      ', bx + 110, by + 27);
    }
    g.font = '21px Arial, sans-serif';
    g.fillText('KM INICIAL:', bx + 14, by + brh + 27);
    fitTextInk(g, d.kmInicial || '', bx + 145, by + brh + 27, 225, 'bold 21px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('KM FINAL:', bx + 20, by + brh * 2 + 27);
    fitTextInk(g, d.kmFinal || '', bx + 145, by + brh * 2 + 27, 225, 'bold 21px Arial, sans-serif');

    y += 168;
    // MOTIVO DA SOLICITAÇÃO
    g.strokeRect(M, y, CW, 40);
    g.font = '21px Arial, sans-serif';
    g.fillText('MOTIVO DA SOLICITAÇÃO:', M + 12, y + 28);
    fitTextInk(g, d.motivoSolicitacao || '', M + 305, y + 28, CW - 320, 'bold 21px Arial, sans-serif');

    y += 50;
    // CLASSIFICAÇÃO DE RISCO
    g.strokeRect(M, y, CW, 42);
    const rCols = [380, 690, 995, 1280];
    for (const cx of rCols) {
      g.beginPath(); g.moveTo(M + cx, y); g.lineTo(M + cx, y + 42); g.stroke();
    }
    g.font = '21px Arial, sans-serif';
    g.fillText('CLASSIFICAÇÃO DE RISCO:', M + 12, y + 28);
    drawCheckbox(g, M + 405, y + 10, 22, d.risco === 'VERMELHA', 'VERMELHA', '20px Arial');
    drawCheckbox(g, M + 715, y + 10, 22, d.risco === 'AMARELA', 'AMARELA', '20px Arial');
    drawCheckbox(g, M + 1020, y + 10, 22, d.risco === 'VERDE', 'VERDE', '20px Arial');
    drawCheckbox(g, M + 1305, y + 10, 22, d.risco === 'AZUL', 'AZUL', '20px Arial');

    y += 52;
    // LOCAL OCORRÊNCIA (3 linhas)
    const locH = 114;
    g.strokeRect(M, y, CW, locH);
    g.beginPath();
    g.moveTo(M, y + 38); g.lineTo(M + CW, y + 38);
    g.moveTo(M, y + 76); g.lineTo(M + CW, y + 76);
    g.stroke();
    g.font = '21px Arial, sans-serif';
    g.fillText('LOCAL OCORRÊNCIA:', M + 12, y + 27);
    const locais = d.locaisOcorrencia || [];
    drawCheckbox(g, M + 285, y + 8, 22, locais.includes('RESIDÊNCIA'), 'RESIDÊNCIA', '20px Arial');
    drawCheckbox(g, M + 520, y + 8, 22, locais.includes('VIA PÚBLICA'), 'VIA PÚBLICA', '20px Arial');
    drawCheckbox(g, M + 755, y + 8, 22, locais.includes('RODOVIA'), 'RODOVIA', '20px Arial');
    drawCheckbox(g, M + 960, y + 8, 22, locais.includes('PS'), 'PS', '20px Arial');
    drawCheckbox(g, M + 1070, y + 8, 22, locais.includes('UBS'), 'UBS', '20px Arial');
    drawCheckbox(g, M + 1195, y + 8, 22, Boolean(d.localOutroCheck || d.localOutroTexto), d.localOutroTexto || '', 'bold 19px Arial', { blueLabel: true });

    g.font = '21px Arial, sans-serif';
    g.fillText('ENDEREÇO:', M + 12, y + 65);
    fitTextInk(g, d.ocorrenciaEndereco || '', M + 155, y + 65, 980, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('NÚMERO:', M + 1160, y + 65);
    fitTextInk(g, d.ocorrenciaNumero || '', M + 1275, y + 65, 260, 'bold 20px Arial, sans-serif');

    g.font = '21px Arial, sans-serif';
    g.fillText('REFERÊNCIA:', M + 12, y + 103);
    fitTextInk(g, d.ocorrenciaReferencia || '', M + 170, y + 103, 860, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('CONTATO:', M + 1055, y + 103);
    fitTextInk(g, d.ocorrenciaContato || '', M + 1180, y + 103, 355, 'bold 20px Arial, sans-serif');

    y += locH + 28;
    // DADOS DA VÍTIMA
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText('DADOS DA VÍTIMA:', M + 4, y - 7);

    const vitH = 190; // 5 linhas de 38
    g.strokeRect(M, y, CW, vitH);
    for (let i = 1; i < 5; i++) {
      g.beginPath(); g.moveTo(M, y + i * 38); g.lineTo(M + CW, y + i * 38); g.stroke();
    }
    // Linha 1: NOME | IDADE | DN
    g.font = '21px Arial, sans-serif';
    g.fillText('NOME:', M + 12, y + 27);
    fitTextInk(g, d.vitimaNome || '', M + 95, y + 27, 965, 'bold 21px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('IDADE:', M + 1075, y + 27);
    fitTextInk(g, d.vitimaIdade || '', M + 1158, y + 27, 105, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('DN:', M + 1275, y + 27);
    fitTextInk(g, d.vitimaDn ? formatDateBR(d.vitimaDn) : '', M + 1322, y + 27, 215, 'bold 20px Arial, sans-serif');

    // Linha 2: ENDEREÇO | NÚMERO | BAIRRO
    g.font = '21px Arial, sans-serif';
    g.fillText('ENDEREÇO:', M + 12, y + 65);
    fitTextInk(g, d.vitimaEndereco || '', M + 150, y + 65, 600, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('NÚMERO:', M + 765, y + 65);
    fitTextInk(g, d.vitimaNumero || '', M + 875, y + 65, 160, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('BAIRRO:', M + 1050, y + 65);
    fitTextInk(g, d.vitimaBairro || '', M + 1150, y + 65, 385, 'bold 20px Arial, sans-serif');

    // Linha 3: CIDADE | CEP | NATURALIDADE
    g.font = '21px Arial, sans-serif';
    g.fillText('CIDADE:', M + 12, y + 103);
    fitTextInk(g, d.vitimaCidade || '', M + 112, y + 103, 420, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('CEP:', M + 550, y + 103);
    fitTextInk(g, d.vitimaCep || '', M + 615, y + 103, 315, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('NATURALIDADE:', M + 950, y + 103);
    fitTextInk(g, d.vitimaNaturalidade || '', M + 1140, y + 103, 395, 'bold 20px Arial, sans-serif');

    // Linha 4: PAI | MÃE
    g.font = '21px Arial, sans-serif';
    g.fillText('PAI:', M + 12, y + 141);
    fitTextInk(g, d.vitimaPai || '', M + 65, y + 141, 630, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('MÃE:', M + 715, y + 141);
    fitTextInk(g, d.vitimaMae || '', M + 780, y + 141, 755, 'bold 20px Arial, sans-serif');

    // Linha 5: CPF | RG | CNS (opcional)
    g.font = '21px Arial, sans-serif';
    g.fillText('CPF:', M + 12, y + 179);
    fitTextInk(g, d.vitimaCpf || '', M + 72, y + 179, 440, 'bold 20px Arial, sans-serif');
    g.font = '21px Arial, sans-serif';
    g.fillText('RG:', M + 540, y + 179);
    fitTextInk(g, d.vitimaRg || '', M + 590, y + 179, 410, 'bold 20px Arial, sans-serif');
    if (d.vitimaCns) {
      g.font = '21px Arial, sans-serif';
      g.fillText('CNS:', M + 1025, y + 179);
      fitTextInk(g, d.vitimaCns, M + 1088, y + 179, 445, 'bold 20px Arial, sans-serif');
    }

    y += vitH + 14;
    // TABELA DE 8 HORÁRIOS COM CABEÇALHO CINZA
    const thHead = 46, thVal = 40;
    g.fillStyle = '#d1d5db';
    g.fillRect(M, y, CW, thHead);
    g.fillStyle = '#000000';
    g.strokeRect(M, y, CW, thHead + thVal);
    g.beginPath(); g.moveTo(M, y + thHead); g.lineTo(M + CW, y + thHead); g.stroke();

    const horariosSchema = window.SAMU_SCHEMA.horariosFicha;
    const colW8 = CW / 8;
    for (let i = 0; i < 8; i++) {
      const cx = M + i * colW8;
      if (i > 0) {
        g.beginPath(); g.moveTo(cx, y); g.lineTo(cx, y + thHead + thVal); g.stroke();
      }
      const lines = horariosSchema[i].short.split('\n');
      g.font = 'bold 15px Arial, sans-serif';
      g.textAlign = 'center';
      if (lines.length === 1) {
        g.fillText(lines[0], cx + colW8 / 2, y + 29);
      } else {
        g.fillText(lines[0], cx + colW8 / 2, y + 19);
        g.fillText(lines[1], cx + colW8 / 2, y + 38);
      }
      const val = (d.horarios && d.horarios[horariosSchema[i].key]) || '';
      fillTextInk(g, val, cx + colW8 / 2, y + thHead + 28, 'bold 22px Arial, sans-serif');
    }
    g.textAlign = 'left';

    // Marca exata de recorte da foto p/ Regulação Médica (do topo até o fim da barra de Horários)
    c1.__regCropBottomY = y + thHead + thVal + 20;

    y += thHead + thVal + 32;
    // TIPO DE ATENDIMENTO (3x5)
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText('TIPO DE ATENDIMENTO:', M + 4, y - 8);
    const taRowH = 38;
    g.strokeRect(M, y, CW, taRowH * 3);
    const colW5 = CW / 5;
    for (let r = 1; r < 3; r++) {
      g.beginPath(); g.moveTo(M, y + r * taRowH); g.lineTo(M + CW, y + r * taRowH); g.stroke();
    }
    for (let c = 1; c < 5; c++) {
      g.beginPath(); g.moveTo(M + c * colW5, y); g.lineTo(M + c * colW5, y + taRowH * 3); g.stroke();
    }
    const tiposSel = d.tiposAtendimento || [];
    const taGrid = window.SAMU_SCHEMA.tiposAtendimentoGrid;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        const item = taGrid[r][c];
        const cx = M + c * colW5 + 10;
        const cy = y + r * taRowH + 8;
        if (item === '__OUTRO__') {
          drawCheckbox(g, cx, cy, 22, Boolean(d.tipoOutroCheck || d.tipoOutroTexto), '', '17px Arial');
          fitTextInk(g, d.tipoOutroTexto || '', cx + 28, cy + 17, colW5 - 42, 'bold 17px Arial, sans-serif');
        } else {
          drawCheckbox(g, cx, cy, 22, tiposSel.includes(item), item, '17px Arial');
        }
      }
    }

    y += taRowH * 3 + 10;
    // SITUAÇÃO DO LOCAL
    g.strokeRect(M, y, CW, 40);
    const sitSplits = [310, 580, 880, 1115, 1270];
    for (const sx of sitSplits) {
      g.beginPath(); g.moveTo(M + sx, y); g.lineTo(M + sx, y + 40); g.stroke();
    }
    g.font = '21px Arial, sans-serif';
    g.fillText('SITUAÇÃO DO LOCAL', M + 8, y + 27);
    const sitSel = d.situacoesLocal || [];
    drawCheckbox(g, M + 322, y + 9, 22, sitSel.includes('MORTE ÓBVIA'), 'MORTE ÓBVIA', '19px Arial');
    drawCheckbox(g, M + 592, y + 9, 22, sitSel.includes('CHAMADO FALSO'), 'CHAMADO FALSO', '19px Arial');
    drawCheckbox(g, M + 892, y + 9, 22, sitSel.includes('EVADIU-SE'), 'EVADIU-SE', '19px Arial');
    drawCheckbox(g, M + 1130, y + 9, 22, sitSel.includes('QTA'), 'QTA', '19px Arial');
    drawCheckbox(g, M + 1285, y + 9, 22, Boolean(d.situacaoOutroCheck || d.situacaoOutroTexto), d.situacaoOutroTexto || '', 'bold 18px Arial', { blueLabel: true });

    y += 66;
    // DESCRIÇÃO DE CENA + BONECO REGRA DOS 9
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText('DESCRIÇÃO DE CENA:', M + 4, y - 8);
    const cenaW = 1235, burnW = CW - cenaW, cenaRows = 8, cenaRowH = 34, cenaH = cenaRows * cenaRowH;
    g.strokeRect(M, y, CW, cenaH);
    g.beginPath(); g.moveTo(M + cenaW, y); g.lineTo(M + cenaW, y + cenaH); g.stroke();
    for (let i = 1; i < cenaRows; i++) {
      g.beginPath(); g.moveTo(M, y + i * cenaRowH); g.lineTo(M + cenaW, y + i * cenaRowH); g.stroke();
    }
    g.font = '19px Arial, sans-serif';
    const cenaLines = wrapTextLines(g, d.descricaoCena || '', cenaW - 24);
    for (let i = 0; i < Math.min(cenaLines.length, cenaRows); i++) {
      fillTextInk(g, cenaLines[i], M + 12, y + (i + 1) * cenaRowH - 8, '19px Arial, sans-serif');
    }

    // Boneco Regra dos 9 à direita
    if (burnImg) {
      const bxImg = M + cenaW + 6, byImg = y + 4, bwImg = burnW - 12, bhImg = cenaH - 8;
      g.drawImage(burnImg, bxImg, byImg, bwImg, bhImg);
      const activeZones = d.burnZonesSelected || [];
      if (activeZones.length > 0) {
        g.save();
        for (const z of window.SAMU_SCHEMA.burnZones) {
          if (activeZones.includes(z.id)) {
            g.fillStyle = 'rgba(220, 38, 38, 0.35)';
            g.strokeStyle = '#dc2626';
            g.lineWidth = 2;
            g.beginPath();
            g.ellipse(bxImg + z.cx * bwImg, byImg + z.cy * bhImg, z.rx * bwImg, z.ry * bhImg, 0, 0, Math.PI * 2);
            g.fill();
            g.stroke();
          }
        }
        g.restore();
      }
    }

    y += cenaH + 10;
    // HÁ QUEIMADURAS?
    g.strokeRect(M, y, CW, 40);
    g.beginPath();
    g.moveTo(M + 305, y); g.lineTo(M + 305, y + 40);
    g.moveTo(M + 585, y); g.lineTo(M + 585, y + 40);
    g.stroke();
    g.font = '21px Arial, sans-serif';
    g.fillText('HÁ QUEIMADURAS?', M + 16, y + 27);
    drawCheckbox(g, M + 325, y + 9, 22, d.haQueimaduras === 'SIM', 'SIM', '20px Arial');
    drawCheckbox(g, M + 455, y + 9, 22, d.haQueimaduras === 'NAO', 'NÃO', '20px Arial');
    g.fillText('SE SIM, QUANTOS POR CENTO:', M + 600, y + 27);
    fitTextInk(g, d.queimadurasPorcentagem ? String(d.queimadurasPorcentagem) : '', M + 965, y + 27, 560, 'bold 21px Arial, sans-serif');

    y += 50;
    // AVALIAÇÃO PRIMÁRIA
    const avH = 74;
    g.strokeRect(M, y, CW, avH);
    const avCols = [305, 620, 930, 1240];
    for (const ax of avCols) {
      g.beginPath(); g.moveTo(M + ax, y); g.lineTo(M + ax, y + avH); g.stroke();
    }
    g.beginPath(); g.moveTo(M + 305, y + 36); g.lineTo(M + CW, y + 36); g.stroke();
    g.font = '21px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('AVALIAÇÃO', M + 152, y + 32);
    g.fillText('PRIMÁRIA', M + 152, y + 58);

    const avHeaders = [
      { label: 'VIA AÉRIA LIBERADA', x1: 305, x2: 620, val: d.viaAerea },
      { label: 'RESPIRAÇÃO', x1: 620, x2: 930, val: d.respiracao },
      { label: 'CIRCULAÇÃO', x1: 930, x2: 1240, val: d.circulacao },
      { label: 'CONSCIENTE', x1: 1240, x2: CW, val: d.consciente }
    ];
    for (const item of avHeaders) {
      const mid = M + (item.x1 + item.x2) / 2;
      g.font = '20px Arial, sans-serif';
      g.fillText(item.label, mid, y + 26);
    }
    g.textAlign = 'left';
    for (const item of avHeaders) {
      drawCheckbox(g, M + item.x1 + 25, y + 44, 21, item.val === 'SIM', 'SIM', '19px Arial');
      drawCheckbox(g, M + item.x1 + 175, y + 44, 21, item.val === 'NAO', 'NÃO', '19px Arial');
    }

    y += avH + 10;
    // PUPILAS
    const pupH = 112;
    g.fillStyle = '#e5e7eb';
    g.fillRect(M + 305, y, 250, pupH);
    g.fillStyle = '#000000';
    g.strokeRect(M, y, CW, pupH);
    const pupCols = [305, 555, 760, 965, 1170, 1320];
    for (const px of pupCols) {
      g.beginPath(); g.moveTo(M + px, y); g.lineTo(M + px, y + pupH); g.stroke();
    }
    g.beginPath();
    g.moveTo(M + 305, y + pupH / 2); g.lineTo(M + 1170, y + pupH / 2);
    g.moveTo(M + 1320, y + pupH / 2); g.lineTo(M + CW, y + pupH / 2);
    g.stroke();

    g.font = '21px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('PUPILAS', M + 152, y + 63);
    g.fillText('DIREITA', M + 430, y + 36);
    g.fillText('ESQUERDA', M + 430, y + 92);
    g.font = '19px Arial, sans-serif';
    g.fillText('REATIVAS', M + 1245, y + 63);
    g.textAlign = 'left';

    const drawPupilOption = (colStart, rowIdx, checked, pImg) => {
      const py = y + rowIdx * (pupH / 2);
      drawCheckbox(g, M + colStart + 14, py + 17, 20, checked, '');
      if (pImg) {
        // Usa metade esquerda do ícone do olho para ficar grande e nítido como na ficha
        g.drawImage(pImg, 0, 60, pImg.width / 2, pImg.height - 120, M + colStart + 52, py + 4, 125, 48);
      }
    };
    drawPupilOption(555, 0, d.pupilaDirTamanho === 'GRANDE', pupilL);
    drawPupilOption(760, 0, d.pupilaDirTamanho === 'MEDIA', pupilM);
    drawPupilOption(965, 0, d.pupilaDirTamanho === 'PEQUENA', pupilS);

    drawPupilOption(555, 1, d.pupilaEsqTamanho === 'GRANDE', pupilL);
    drawPupilOption(760, 1, d.pupilaEsqTamanho === 'MEDIA', pupilM);
    drawPupilOption(965, 1, d.pupilaEsqTamanho === 'PEQUENA', pupilS);

    drawCheckbox(g, M + 1335, y + 17, 20, d.pupilaDirReativa === 'SIM', 'SIM', '18px Arial');
    drawCheckbox(g, M + 1435, y + 17, 20, d.pupilaDirReativa === 'NAO', 'NÃO', '18px Arial');
    drawCheckbox(g, M + 1335, y + 73, 20, d.pupilaEsqReativa === 'SIM', 'SIM', '18px Arial');
    drawCheckbox(g, M + 1435, y + 73, 20, d.pupilaEsqReativa === 'NAO', 'NÃO', '18px Arial');

    y += pupH + 10;
    // SINAIS VITAIS
    const svH = 68;
    g.strokeRect(M, y, CW, svH);
    const svStart = 305;
    const svW = (CW - svStart) / 6;
    g.beginPath(); g.moveTo(M + svStart, y); g.lineTo(M + svStart, y + svH); g.stroke();
    g.beginPath(); g.moveTo(M + svStart, y + 32); g.lineTo(M + CW, y + 32); g.stroke();
    g.font = '21px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('SINAIS VITAIS', M + 152, y + 42);
    const svItems = [
      { label: 'PA', val: d.svPa },
      { label: 'FC', val: d.svFc },
      { label: 'FR', val: d.svFr },
      { label: 'SAT', val: d.svSat },
      { label: 'DEXTRO', val: d.svDextro },
      { label: 'TEMP.', val: d.svTemp }
    ];
    for (let i = 0; i < 6; i++) {
      const sx = M + svStart + i * svW;
      if (i > 0) {
        g.beginPath(); g.moveTo(sx, y); g.lineTo(sx, y + svH); g.stroke();
      }
      g.font = '20px Arial, sans-serif';
      g.fillText(svItems[i].label, sx + svW / 2, y + 23);
      fitTextInk(g, svItems[i].val || '', sx + svW / 2, y + 58, svW - 12, 'bold 21px Arial, sans-serif');
    }
    g.textAlign = 'left';

    y += svH + 10;
    // PELE
    g.strokeRect(M, y, CW, 40);
    const peleStart = 305;
    const peleW = (CW - peleStart) / 6;
    g.font = '21px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('PELE', M + 152, y + 27);
    g.textAlign = 'left';
    const peles = d.pele || [];
    window.SAMU_SCHEMA.peleOpcoes.forEach((opt, idx) => {
      const px = M + peleStart + idx * peleW;
      g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + 40); g.stroke();
      drawCheckbox(g, px + 12, y + 9, 20, peles.includes(opt), opt, '18px Arial');
    });

    y += 50;
    // ANTECEDENTES PATOLÓGICOS
    const antH = 54;
    g.strokeRect(M, y, CW, antH);
    g.font = '20px Arial, sans-serif';
    g.fillText('ANTECEDENTES', M + 20, y + 23);
    g.fillText('PATOLÓGICOS', M + 20, y + 46);
    const antSplits = [265, 390, 515, 700, 995, 1215, 1345];
    const antSel = d.antecedentes || [];
    window.SAMU_SCHEMA.antecedentesOpcoes.forEach((opt, idx) => {
      const ax = M + antSplits[idx];
      g.beginPath(); g.moveTo(ax, y); g.lineTo(ax, y + antH); g.stroke();
      drawCheckbox(g, ax + 10, y + 16, 20, antSel.includes(opt), opt, '18px Arial');
    });

    y += antH + 10;
    // MEDICAMENTO EM USO (4 caixas)
    const medH = 44;
    g.strokeRect(M, y, CW, medH);
    g.font = '15px Arial, sans-serif';
    g.fillText('MEDICAMENTO', M + 14, y + 18);
    g.fillText('EM USO', M + 14, y + 36);
    const medStart = 265;
    const medW = (CW - medStart) / 4;
    let combinedMeds = [];
    if (Array.isArray(d.medicamentosSelecionados) && d.medicamentosSelecionados.length > 0) {
      combinedMeds = combinedMeds.concat(d.medicamentosSelecionados);
    }
    if (d.medicamentosOutro && String(d.medicamentosOutro).trim()) {
      combinedMeds = combinedMeds.concat(
        String(d.medicamentosOutro).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
      );
    }
    if (combinedMeds.length === 0 && Array.isArray(d.medicamentosLista)) {
      combinedMeds = d.medicamentosLista.map(s => String(s || '').trim()).filter(Boolean);
    }
    if (combinedMeds.length === 0 && d.medicamentos) {
      combinedMeds = String(d.medicamentos).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    }

    // Distribui uniformemente entre as 4 caixas (suporta até 8+ itens em 2 linhas por caixa)
    const medBuckets = [[], [], [], []];
    combinedMeds.forEach((item, idx) => {
      medBuckets[idx % 4].push(item);
    });

    for (let i = 0; i < 4; i++) {
      const mx = M + medStart + i * medW;
      g.beginPath(); g.moveTo(mx, y); g.lineTo(mx, y + medH); g.stroke();
      const bucket = medBuckets[i];
      if (bucket.length === 1) {
        fitTextInk(g, bucket[0], mx + 8, y + 28, medW - 14, 'bold 17px Arial, sans-serif');
      } else if (bucket.length >= 2) {
        fitTextInk(g, bucket[0], mx + 8, y + 17, medW - 14, 'bold 14px Arial, sans-serif');
        fitTextInk(g, bucket.slice(1).join(', '), mx + 8, y + 37, medW - 14, 'bold 14px Arial, sans-serif');
      }
    }

    y += medH + 10;
    // ALERGIAS
    g.strokeRect(M, y, CW, 40);
    g.beginPath(); g.moveTo(M + 265, y); g.lineTo(M + 265, y + 40); g.stroke();
    g.font = '18px Arial, sans-serif';
    g.fillText('ALERGIAS', M + 14, y + 27);
    const combinedAlergias = []
      .concat(Array.isArray(d.alergiasSelecionadas) ? d.alergiasSelecionadas : [])
      .concat(d.alergiasOutro && String(d.alergiasOutro).trim() ? [String(d.alergiasOutro).trim()] : []);
    const alergiasStr = combinedAlergias.length > 0 ? combinedAlergias.join(', ') : (d.alergias || '');
    fitTextInk(g, alergiasStr, M + 280, y + 27, CW - 295, 'bold 18px Arial, sans-serif');

    y += 66;
    // PROCEDIMENTOS REALIZADOS (3x5)
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText('PROCEDIMENTOS REALIZADOS:', M + 4, y - 8);
    const prRowH = 38;
    g.strokeRect(M, y, CW, prRowH * 3);
    for (let r = 1; r < 3; r++) {
      g.beginPath(); g.moveTo(M, y + r * prRowH); g.lineTo(M + CW, y + r * prRowH); g.stroke();
    }
    for (let c = 1; c < 5; c++) {
      g.beginPath(); g.moveTo(M + c * colW5, y); g.lineTo(M + c * colW5, y + prRowH * 3); g.stroke();
    }
    const procSel = d.procedimentos || [];
    const prGrid = window.SAMU_SCHEMA.procedimentosGrid;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        const item = prGrid[r][c];
        const cx = M + c * colW5 + 10;
        const cy = y + r * prRowH + 8;
        if (item === '__OUTRO__') {
          drawCheckbox(g, cx, cy, 21, Boolean(d.procOutroCheck || d.procOutroTexto), '', '17px Arial');
          fitTextInk(g, d.procOutroTexto || '', cx + 28, cy + 17, colW5 - 42, 'bold 17px Arial, sans-serif');
        } else {
          drawCheckbox(g, cx, cy, 21, procSel.includes(item), item, '18px Arial');
        }
      }
    }

    y += prRowH * 3 + 10;
    // CONDUTA (2 linhas)
    g.strokeRect(M, y, CW, 68);
    g.beginPath(); g.moveTo(M, y + 34); g.lineTo(M + CW, y + 34); g.stroke();
    g.font = '20px Arial, sans-serif';
    g.fillText('CONDUTA:', M + 12, y + 25);
    g.font = 'bold 19px Arial, sans-serif';
    const condLines = wrapTextLines(g, d.conduta || '', CW - 150);
    if (condLines[0]) fillTextInk(g, condLines[0], M + 135, y + 25, 'bold 19px Arial, sans-serif');
    if (condLines[1]) fitTextInk(g, condLines.slice(1).join(' '), M + 12, y + 59, CW - 24, 'bold 19px Arial, sans-serif');

    y += 78;
    // MÉDICO REGULADOR
    g.strokeRect(M, y, CW, 36);
    g.font = '20px Arial, sans-serif';
    g.fillText('MÉDICO REGULADOR:', M + 12, y + 25);
    fitTextInk(g, d.medicoRegulador || '', M + 255, y + 25, CW - 270, 'bold 19px Arial, sans-serif');

    y += 46;
    // DESCRIÇÃO DOS PERTENCES DO PACIENTE
    const restH = Math.max(96, H - 36 - y);
    const pRowH = restH / 3;
    g.strokeRect(M, y, CW, restH);
    g.beginPath();
    g.moveTo(M, y + pRowH); g.lineTo(M + CW, y + pRowH);
    g.moveTo(M, y + pRowH * 2); g.lineTo(M + CW, y + pRowH * 2);
    g.stroke();
    g.font = '20px Arial, sans-serif';
    g.fillText('DESCRIÇÃO DOS PERTENCES DO PACIENTE (DEIXADOS NO DESTINO):', M + 12, y + pRowH - 8);
    g.font = 'bold 19px Arial, sans-serif';
    const pertLines = wrapTextLines(g, d.pertences || '', CW - 24);
    if (pertLines[0]) fillTextInk(g, pertLines[0], M + 12, y + pRowH * 2 - 8, 'bold 19px Arial, sans-serif');
    if (pertLines[1]) fitTextInk(g, pertLines.slice(1).join(' '), M + 12, y + pRowH * 3 - 8, CW - 24, 'bold 19px Arial, sans-serif');

    // -------------------- PÁGINA 2 (VERSO) --------------------
    const c2 = document.createElement('canvas');
    c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d');
    g2.fillStyle = '#ffffff';
    g2.fillRect(0, 0, W, H);

    // Marca d'água inclinada igual ao verso do PDF 2026
    if (watermarkImg) {
      g2.save();
      g2.translate(W / 2, H / 2 - 80);
      g2.rotate(-Math.PI / 5);
      g2.globalAlpha = 0.08;
      g2.drawImage(watermarkImg, -550, -450, 1100, 900);
      g2.restore();
    }

    g2.strokeStyle = '#111111';
    g2.fillStyle = '#000000';
    g2.lineWidth = 1.8;

    let y2 = 58;
    // RELATÓRIO ENFERMAGEM (23 linhas pautadas)
    const relRows = 23, relRowH = 44, relH = (relRows + 1) * relRowH;
    g2.strokeRect(M, y2, CW, relH);
    g2.font = 'bold 23px Arial, sans-serif';
    g2.fillText('RELATORIO ENFERMAGEM:', M + 14, y2 + 31);
    for (let i = 1; i <= relRows; i++) {
      g2.beginPath();
      g2.moveTo(M, y2 + i * relRowH);
      g2.lineTo(M + CW, y2 + i * relRowH);
      g2.stroke();
    }
    g2.font = '21px Arial, sans-serif';
    const relLines = wrapTextLines(g2, d.relatorioEnfermagem || '', CW - 28);
    for (let i = 0; i < Math.min(relLines.length, relRows); i++) {
      fillTextInk(g2, relLines[i], M + 14, y2 + (i + 2) * relRowH - 11, '21px Arial, sans-serif');
    }

    y2 += relH + 34;
    // QUADRO DE TERMOS (RECUSA / COMPARECIMENTO / ALTA LOCAL) + SETORES
    const termosSel = d.termosSelecionados || [];
    const termoBoxH = 470;
    g2.strokeRect(M, y2, CW, termoBoxH);

    // 1) Recusa
    let ty = y2 + 16;
    drawCheckbox(g2, M + 16, ty, 20, termosSel.includes('RECUSA'), '');
    g2.font = 'bold 21px Arial, sans-serif';
    g2.fillText('RECUSA DE ATENDIMENTO:', M + 46, ty + 18);
    g2.font = '20px Arial, sans-serif';
    g2.fillText('Eu abaixo assinado, devidamente orientado e ciente dos riscos, recuso atendimento,', M + 350, ty + 18);
    g2.fillText('assumindo total responsabilidade de tal recusa, isentando o serviço SAMU de qualquer responsabilidade advinda deste', M + 16, ty + 46);
    g2.fillText('ato.', M + 16, ty + 72);

    // 2) Confirmação de Comparecimento
    ty += 88;
    drawCheckbox(g2, M + 16, ty, 20, termosSel.includes('COMPARECIMENTO'), '');
    g2.font = 'bold 21px Arial, sans-serif';
    g2.fillText('CONFIRMAÇÃO DE COMPARECIMENTO DA EQUIPE:', M + 46, ty + 18);
    g2.font = '20px Arial, sans-serif';
    g2.fillText('Eu abaixo assinado, confirmo o comparecimento da equipe', M + 615, ty + 18);
    g2.fillText('do SAMU no local da ocorrência e a ausência da vítima (s) no mesmo, isentando o serviço do SAMU de qualquer', M + 16, ty + 46);
    g2.fillText('responsabilidade advinda após a sua saída do local.', M + 16, ty + 72);

    // 3) Alta Local
    ty += 88;
    drawCheckbox(g2, M + 16, ty, 20, termosSel.includes('ALTA_LOCAL'), '');
    g2.font = 'bold 21px Arial, sans-serif';
    g2.fillText('ALTA LOCAL:', M + 46, ty + 18);
    g2.font = '20px Arial, sans-serif';
    g2.fillText('Eu abaixo assinado, confirmo o comparecimento da equipe do SAMU no local da ocorrência no qual', M + 195, ty + 18);
    g2.font = 'bold 20px Arial, sans-serif';
    g2.fillText('fui atendido e devidamente orientado,', M + 16, ty + 46);
    g2.beginPath(); g2.moveTo(M + 16, ty + 51); g2.lineTo(M + 382, ty + 51); g2.stroke();
    g2.font = '20px Arial, sans-serif';
    g2.fillText('isentando o serviço do SAMU de qualquer responsabilidade advinda após a sua', M + 392, ty + 46);
    g2.fillText('saída do local.', M + 16, ty + 72);

    // Nome Completo / CPF / Assinatura do Termo
    ty += 110;
    g2.font = 'bold 21px Arial, sans-serif';
    g2.fillText('NOME COMPLETO:', M + 70, ty);
    g2.beginPath(); g2.moveTo(M + 275, ty + 4); g2.lineTo(M + 1390, ty + 4); g2.stroke();
    fitTextInk(g2, d.termoNome || '', M + 285, ty - 2, 1090, 'bold 22px Arial, sans-serif');

    ty += 62;
    g2.font = 'bold 21px Arial, sans-serif';
    g2.fillText('CPF:', M + 265, ty);
    g2.beginPath(); g2.moveTo(M + 325, ty + 4); g2.lineTo(M + 790, ty + 4); g2.stroke();
    fitTextInk(g2, d.termoCpf || '', M + 335, ty - 2, 445, 'bold 22px Arial, sans-serif');

    // Linha de Assinatura do Termo
    const sigLineX1 = M + 910, sigLineX2 = M + 1500;
    const sigLineY = ty + 36;
    if (sigTermoImg) {
      drawSignatureFit(g2, sigTermoImg, sigLineX1 + 20, sigLineY - 92, sigLineX2 - sigLineX1 - 40, 90);
    }
    g2.beginPath(); g2.moveTo(sigLineX1, sigLineY); g2.lineTo(sigLineX2, sigLineY); g2.stroke();
    g2.font = 'bold 21px Arial, sans-serif';
    g2.textAlign = 'center';
    g2.fillText('ASSINATURA', (sigLineX1 + sigLineX2) / 2, sigLineY + 26);
    g2.textAlign = 'left';

    y2 += termoBoxH;
    // SETOR RECOMENDADO vs SETOR ADMITIDO + OBS
    const setorHeadH = 38, setorBodyH = 132, obsH = 136;
    g2.strokeRect(M, y2, CW, setorHeadH + setorBodyH + obsH);
    g2.beginPath();
    g2.moveTo(M, y2 + setorHeadH); g2.lineTo(M + CW, y2 + setorHeadH);
    g2.moveTo(M + CW / 2, y2); g2.lineTo(M + CW / 2, y2 + setorHeadH + setorBodyH);
    g2.moveTo(M, y2 + setorHeadH + setorBodyH); g2.lineTo(M + CW, y2 + setorHeadH + setorBodyH);
    g2.stroke();

    g2.font = 'bold 20px Arial, sans-serif';
    g2.textAlign = 'center';
    g2.fillText('SETOR RECOMENDADO PELA EQUIPE DO SAMU', M + CW / 4, y2 + 26);
    g2.fillText('SETOR EM QUE O HOSPITAL ADMITIU O PACIENTE', M + (CW * 3) / 4, y2 + 26);
    g2.textAlign = 'left';

    const setores = window.SAMU_SCHEMA.setoresHospital;
    const recSel = d.setorRecomendado || [];
    const admSel = d.setorAdmitido || [];
    setores.forEach((st, idx) => {
      const sy = y2 + setorHeadH + 10 + idx * 30;
      drawCheckbox(g2, M + 18, sy, 20, Array.isArray(recSel) ? recSel.includes(st) : recSel === st, st, '20px Arial');
      drawCheckbox(g2, M + CW / 2 + 18, sy, 20, Array.isArray(admSel) ? admSel.includes(st) : admSel === st, st, '20px Arial');
    });

    // OBS (3 linhas)
    const obsY = y2 + setorHeadH + setorBodyH;
    const obsRowH = obsH / 4;
    for (let i = 1; i < 4; i++) {
      g2.beginPath(); g2.moveTo(M, obsY + i * obsRowH); g2.lineTo(M + CW, obsY + i * obsRowH); g2.stroke();
    }
    g2.font = 'bold 20px Arial, sans-serif';
    g2.fillText('OBS:', M + 14, obsY + 25);
    g2.font = '20px Arial, sans-serif';
    const obsLines = wrapTextLines(g2, d.obsHospital || '', CW - 28);
    for (let i = 0; i < Math.min(obsLines.length, 3); i++) {
      fillTextInk(g2, obsLines[i], M + 14, obsY + (i + 2) * obsRowH - 8, '20px Arial, sans-serif');
    }

    y2 += setorHeadH + setorBodyH + obsH + 40;
    // RODAPÉ DE 4 COLUNAS: DESTINO | RECEBIDO POR (COREN/CRM) | ENFERMAGEM (SAMU) | COND. SOCORRISTA (SAMU)
    const footH = Math.min(270, H - 55 - y2);
    const fc = [0, 385, 780, 1165, CW];
    g2.strokeRect(M, y2, CW, footH);
    g2.beginPath(); g2.moveTo(M, y2 + 38); g2.lineTo(M + CW, y2 + 38); g2.stroke();
    for (let i = 1; i < 4; i++) {
      g2.beginPath(); g2.moveTo(M + fc[i], y2); g2.lineTo(M + fc[i], y2 + footH); g2.stroke();
    }

    g2.font = '21px Arial, sans-serif';
    g2.fillText('DESTINO:', M + 14, y2 + 27);
    g2.fillText('RECEBIDO POR:', M + fc[1] + 14, y2 + 27);
    g2.textAlign = 'center';
    g2.fillText('ENFERMAGEM :(SAMU)', M + (fc[2] + fc[3]) / 2, y2 + 27);
    g2.font = '19px Arial, sans-serif';
    g2.fillText('COND. SOCORRISTA:(SAMU)', M + (fc[3] + fc[4]) / 2, y2 + 27);
    g2.textAlign = 'left';

    // Destino texto
    g2.font = 'bold 22px Arial, sans-serif';
    const destLines = wrapTextLines(g2, d.destino || '', fc[1] - 28);
    destLines.slice(0, 4).forEach((ln, idx) => {
      fillTextInk(g2, ln, M + 14, y2 + 80 + idx * 32, 'bold 22px Arial, sans-serif');
    });

    // Coluna Recebido Por + linha pontilhada + COREN/CRM
    const corenY = y2 + footH - 40;
    g2.beginPath();
    g2.moveTo(M + fc[1], corenY); g2.lineTo(M + fc[2], corenY);
    g2.moveTo(M + fc[1] + 215, corenY); g2.lineTo(M + fc[1] + 215, y2 + footH);
    g2.stroke();
    g2.save();
    g2.setLineDash([4, 4]);
    g2.beginPath(); g2.moveTo(M + fc[1] + 8, corenY - 52); g2.lineTo(M + fc[2] - 8, corenY - 52); g2.stroke();
    g2.restore();

    if (sigRecebidoImg) {
      drawSignatureFit(g2, sigRecebidoImg, M + fc[1] + 14, y2 + 44, (fc[2] - fc[1]) - 28, corenY - 102 - y2);
    }
    if (d.recebidoPorNome) {
      g2.textAlign = 'center';
      fitTextInk(g2, d.recebidoPorNome, M + (fc[1] + fc[2]) / 2, corenY - 16, (fc[2] - fc[1]) - 16, 'bold 18px Arial, sans-serif');
      g2.textAlign = 'left';
    }
    g2.font = '20px Arial, sans-serif';
    g2.fillText('COREN/CRM:', M + fc[1] + 14, corenY + 28);
    fitTextInk(g2, d.recebidoCorenCrm || '', M + fc[1] + 224, corenY + 28, (fc[2] - fc[1]) - 232, 'bold 19px Arial, sans-serif');

    // Coluna Enfermagem SAMU (suporta 1 profissional ou 2 profissionais: Enfermeiro(a) + Téc. Enfermagem)
    const enfBodyTop = y2 + 38;
    const enfBodyBottom = y2 + footH;
    const enfColW = fc[3] - fc[2];
    const enfCenterX = M + (fc[2] + fc[3]) / 2;
    const hasEnf2 = Boolean(
      String(d.enfermagem2Nome || '').trim() ||
      String(d.enfermagem2Coren || '').trim() ||
      sigEnf2Img
    );

    if (hasEnf2) {
      const midEnfY = enfBodyTop + (enfBodyBottom - enfBodyTop) / 2;
      const halfH = midEnfY - enfBodyTop;
      g2.beginPath();
      g2.moveTo(M + fc[2], midEnfY);
      g2.lineTo(M + fc[3], midEnfY);
      g2.stroke();

      if (sigEnfImg) {
        drawSignatureFit(g2, sigEnfImg, M + fc[2] + 14, enfBodyTop + 4, enfColW - 28, Math.max(34, halfH - 42));
      }
      g2.textAlign = 'center';
      if (d.enfermagemNome) {
        fitTextInk(g2, d.enfermagemNome, enfCenterX, midEnfY - 21, enfColW - 14, 'bold 15px Arial, sans-serif');
      }
      if (d.enfermagemCoren) {
        fitTextInk(g2, d.enfermagemCoren, enfCenterX, midEnfY - 5, enfColW - 14, '14px Arial, sans-serif');
      }

      if (sigEnf2Img) {
        drawSignatureFit(g2, sigEnf2Img, M + fc[2] + 14, midEnfY + 4, enfColW - 28, Math.max(34, halfH - 42));
      }
      if (d.enfermagem2Nome) {
        fitTextInk(g2, d.enfermagem2Nome, enfCenterX, enfBodyBottom - 21, enfColW - 14, 'bold 15px Arial, sans-serif');
      }
      if (d.enfermagem2Coren) {
        fitTextInk(g2, d.enfermagem2Coren, enfCenterX, enfBodyBottom - 5, enfColW - 14, '14px Arial, sans-serif');
      }
    } else {
      if (sigEnfImg) {
        drawSignatureFit(g2, sigEnfImg, M + fc[2] + 16, y2 + 48, enfColW - 32, footH - 115);
      }
      g2.textAlign = 'center';
      if (d.enfermagemNome) {
        fitTextInk(g2, d.enfermagemNome, enfCenterX, y2 + footH - 38, enfColW - 16, 'bold 18px Arial, sans-serif');
      }
      if (d.enfermagemCoren) {
        fitTextInk(g2, d.enfermagemCoren, enfCenterX, y2 + footH - 14, enfColW - 16, '17px Arial, sans-serif');
      }
    }

    // Coluna Condutor Socorrista SAMU (suporta 1 Condutor ou 2 Condutores no plantão)
    const condBodyTop = y2 + 38;
    const condBodyBottom = y2 + footH;
    const condColW = fc[4] - fc[3];
    const condCenterX = M + (fc[3] + fc[4]) / 2;
    const hasCond2 = Boolean(
      String(d.condutor2Nome || '').trim() ||
      sigCond2Img
    );

    if (hasCond2) {
      const midCondY = condBodyTop + (condBodyBottom - condBodyTop) / 2;
      const halfCondH = midCondY - condBodyTop;
      g2.beginPath();
      g2.moveTo(M + fc[3], midCondY);
      g2.lineTo(M + fc[4], midCondY);
      g2.stroke();

      if (sigCondImg) {
        drawSignatureFit(g2, sigCondImg, M + fc[3] + 14, condBodyTop + 4, condColW - 28, Math.max(38, halfCondH - 28));
      }
      g2.textAlign = 'center';
      if (d.condutorNome) {
        fitTextInk(g2, d.condutorNome, condCenterX, midCondY - 9, condColW - 14, 'bold 16px Arial, sans-serif');
      }

      if (sigCond2Img) {
        drawSignatureFit(g2, sigCond2Img, M + fc[3] + 14, midCondY + 4, condColW - 28, Math.max(38, halfCondH - 28));
      }
      if (d.condutor2Nome) {
        fitTextInk(g2, d.condutor2Nome, condCenterX, condBodyBottom - 9, condColW - 14, 'bold 16px Arial, sans-serif');
      }
    } else {
      if (sigCondImg) {
        drawSignatureFit(g2, sigCondImg, M + fc[3] + 16, y2 + 48, condColW - 32, footH - 110);
      }
      g2.textAlign = 'center';
      if (d.condutorNome) {
        fitTextInk(g2, d.condutorNome, condCenterX, y2 + footH - 22, condColW - 16, 'bold 18px Arial, sans-serif');
      }
    }
    g2.textAlign = 'left';

    return [c1, c2];
  }

  /* ==========================================================================
   * 2. RENDERIZADOR OFICIAL: CHECK LIST CONDUTOR / SOCORRISTA (2 PÁGS RETRATO)
   * ========================================================================== */
  async function renderCondutorCanvases(d) {
    const assets = window.SAMU_ASSETS || {};
    const [samuLogo, orlandiaLogo, ambImg, sigDiurnoImg, sigNoturnoImg, sigAbastImg] = await Promise.all([
      loadImg(assets.samu_logo),
      loadImg(assets.orlandia_logo),
      loadImg(assets.ambulance_diagram),
      loadImg(d.sigCondutorDiurno),
      loadImg(d.sigCondutorNoturno),
      loadImg(d.sigAbastecimento)
    ]);

    const W = 1654, H = 2339, M = 48, CW = W - M * 2;

    // PÁGINA 1
    const c1 = document.createElement('canvas');
    c1.width = W; c1.height = H;
    const g = c1.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#111111'; g.fillStyle = '#000000'; g.lineWidth = 1.8;

    let y = 42;
    g.strokeRect(M, y, CW, 140);
    if (samuLogo) g.drawImage(samuLogo, M + 20, y + 10, 215, 120);
    if (orlandiaLogo) g.drawImage(orlandiaLogo, M + CW - 165, y + 10, 140, 120);
    g.textAlign = 'center';
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText('SAMU ORLÂNDIA', M + CW / 2, y + 56);
    g.font = 'bold 26px Arial, sans-serif';
    g.fillText('CHECK LIST - CONDUTOR / SOCORRISTA', M + CW / 2, y + 104);
    g.textAlign = 'left';

    y += 140;
    // Data + Viatura
    g.strokeRect(M, y, CW, 92);
    g.font = 'bold 20px Arial, sans-serif';
    g.fillText('Data: ', M + 14, y + 34);
    const condDataOff = M + 14 + g.measureText('Data: ').width;
    if (d.data) {
      fillTextInk(g, formatDateBR(d.data), condDataOff, y + 34, 'bold 20px Arial, sans-serif');
    } else {
      g.fillText('    /    /      ', condDataOff, y + 34);
    }
    g.fillText('Viatura:', M + 310, y + 34);

    drawCheckbox(g, M + 420, y + 14, 21, d.viaturaId === 'master_29', 'Renault Master 29  Placa: TIW 4I27', '19px Arial');
    drawCheckbox(g, M + 960, y + 14, 21, d.viaturaId === 'master_133', 'Renault Master 133  Placa: SVZ 4D86', '19px Arial');
    drawCheckbox(g, M + 420, y + 54, 21, d.viaturaId === 'iveco_46', 'Iveco Daily 46  Placa: EVA 1778', '19px Arial');
    drawCheckbox(g, M + 960, y + 54, 21, d.viaturaId === 'outra', 'Outra Placa: ', '19px Arial');
    g.font = '19px Arial, sans-serif';
    const outraPlacaOff = M + 960 + 29 + g.measureText('Outra Placa: ').width;
    if (d.outraPlaca) {
      fitTextInk(g, d.outraPlaca, outraPlacaOff, y + 71, M + CW - outraPlacaOff - 12, 'bold 19px Arial, sans-serif');
    } else {
      g.fillText('___________', outraPlacaOff, y + 71);
    }

    y += 92;
    // Condutor Diurno / Noturno
    g.strokeRect(M, y, CW, 44);
    g.beginPath(); g.moveTo(M + CW / 2, y); g.lineTo(M + CW / 2, y + 44); g.stroke();
    g.font = '20px Arial, sans-serif';
    g.fillText('Condutor Diurno:', M + 14, y + 29);
    fitTextInk(g, d.condutorDiurno || '', M + 185, y + 29, CW / 2 - 200, 'bold 20px Arial, sans-serif');
    g.font = '20px Arial, sans-serif';
    g.fillText('Condutor Noturno:', M + CW / 2 + 14, y + 29);
    fitTextInk(g, d.condutorNoturno || '', M + CW / 2 + 195, y + 29, CW / 2 - 210, 'bold 20px Arial, sans-serif');

    y += 44;
    // Abastecimento (com suporte a Assinatura desenhada com o dedo na tela)
    const abastBoxH = 64;
    g.strokeRect(M, y, CW, abastBoxH);
    g.font = '20px Arial, sans-serif';
    if (d.abastRealizado === 'NAO' && !d.abastLitros && !d.abastHora && !d.abastKm && !d.abastAss && !sigAbastImg) {
      g.fillText('Abastecimento (litros):', M + 14, y + 39);
      fillTextInk(g, 'NÃO REALIZADO', M + 235, y + 39, 'bold 20px Arial, sans-serif');
      g.fillText('Hora:', M + 455, y + 39);
      fillTextInk(g, '---', M + 515, y + 39, 'bold 20px Arial, sans-serif');
      g.fillText('KM:', M + 700, y + 39);
      fillTextInk(g, '---', M + 748, y + 39, 'bold 20px Arial, sans-serif');
      g.fillText('ASS:', M + 1020, y + 39);
      fillTextInk(g, '---', M + 1084, y + 39, 'bold 20px Arial, sans-serif');
    } else {
      g.fillText('Abastecimento (litros):', M + 14, y + 39);
      if (d.abastLitros) {
        fitTextInk(g, d.abastLitros, M + 235, y + 39, 200, 'bold 20px Arial, sans-serif');
      } else {
        g.font = 'bold 20px Arial, sans-serif';
        g.fillText('______', M + 235, y + 39);
      }

      g.font = '20px Arial, sans-serif';
      g.fillText('Hora:', M + 455, y + 39);
      if (d.abastHora) {
        fitTextInk(g, d.abastHora, M + 515, y + 39, 165, 'bold 20px Arial, sans-serif');
      } else {
        g.font = 'bold 20px Arial, sans-serif';
        g.fillText('_____', M + 515, y + 39);
      }

      g.font = '20px Arial, sans-serif';
      g.fillText('KM:', M + 700, y + 39);
      if (d.abastKm) {
        fitTextInk(g, d.abastKm, M + 748, y + 39, 250, 'bold 20px Arial, sans-serif');
      } else {
        g.font = 'bold 20px Arial, sans-serif';
        g.fillText('_________', M + 748, y + 39);
      }

      g.font = '20px Arial, sans-serif';
      g.fillText('ASS:', M + 1020, y + 39);
      g.beginPath();
      g.moveTo(M + 1076, y + 48);
      g.lineTo(M + CW - 18, y + 48);
      g.stroke();

      if (sigAbastImg) {
        drawSignatureFit(g, sigAbastImg, M + 1082, y + 4, CW - 1106, 54);
      } else if (d.abastAss) {
        fitTextInk(g, d.abastAss, M + 1084, y + 39, CW - 1108, 'bold 19px Arial, sans-serif');
      }
    }

    y += abastBoxH + 10;
    // Tabela de 29 linhas (Esquerda: 29 itens | Direita: 20 itens + Assinaturas Diurno/Noturno)
    const rowH = 62;
    const halfW = CW / 2;
    // Cabeçalho
    g.fillStyle = '#e5e7eb';
    g.fillRect(M, y, CW, 46);
    g.fillStyle = '#000000';
    g.strokeRect(M, y, CW, 46);

    const drawSubCols = (baseX, topY, height) => {
      g.beginPath();
      g.moveTo(baseX + 68, topY); g.lineTo(baseX + 68, topY + height);
      g.moveTo(baseX + halfW - 190, topY); g.lineTo(baseX + halfW - 190, topY + height);
      g.moveTo(baseX + halfW - 95, topY); g.lineTo(baseX + halfW - 95, topY + height);
      g.stroke();
    };
    g.beginPath(); g.moveTo(M + halfW, y); g.lineTo(M + halfW, y + 46); g.stroke();
    drawSubCols(M, y, 46);
    drawSubCols(M + halfW, y, 46);

    g.font = 'bold 18px Arial, sans-serif';
    g.textAlign = 'center';
    [M, M + halfW].forEach(bx => {
      g.fillText('QTD', bx + 34, y + 29);
      g.fillText('ITEM', bx + 68 + (halfW - 258) / 2, y + 29);
      g.fillText('Diurno', bx + halfW - 142, y + 29);
      g.fillText('Noturno', bx + halfW - 47, y + 29);
    });
    g.textAlign = 'left';

    y += 46;
    const leftItems = window.SAMU_SCHEMA.condutorLeftItems;
    const rightItems = window.SAMU_SCHEMA.condutorRightItems;
    const totalRows = leftItems.length; // 29
    const valsDiurno = d.itensDiurno || {};
    const valsNoturno = d.itensNoturno || {};

    // Coluna Esquerda (29 linhas)
    g.strokeRect(M, y, halfW, totalRows * rowH);
    drawSubCols(M, y, totalRows * rowH);
    for (let i = 0; i < totalRows; i++) {
      const ry = y + i * rowH;
      if (i > 0) {
        g.beginPath(); g.moveTo(M, ry); g.lineTo(M + halfW, ry); g.stroke();
      }
      const it = leftItems[i];
      g.font = '19px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText(it.qty, M + 34, ry + 38);
      fillTextInk(g, valsDiurno[it.id] || '', M + halfW - 142, ry + 38, 'bold 20px Arial, sans-serif');
      fillTextInk(g, valsNoturno[it.id] || '', M + halfW - 47, ry + 38, 'bold 20px Arial, sans-serif');
      g.textAlign = 'left';
      g.font = '20px Arial, sans-serif';
      fitText(g, it.name, M + 80, ry + 38, halfW - 280);
    }

    // Coluna Direita: 20 itens + quadros de Assinatura Diurno e Noturno
    const rightItemsH = rightItems.length * rowH;
    g.strokeRect(M + halfW, y, halfW, totalRows * rowH);
    drawSubCols(M + halfW, y, rightItemsH);
    for (let i = 0; i < rightItems.length; i++) {
      const ry = y + i * rowH;
      if (i > 0) {
        g.beginPath(); g.moveTo(M + halfW, ry); g.lineTo(M + CW, ry); g.stroke();
      }
      const it = rightItems[i];
      g.font = '19px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText(it.qty, M + halfW + 34, ry + 38);
      fillTextInk(g, valsDiurno[it.id] || '', M + CW - 142, ry + 38, 'bold 20px Arial, sans-serif');
      fillTextInk(g, valsNoturno[it.id] || '', M + CW - 47, ry + 38, 'bold 20px Arial, sans-serif');
      g.textAlign = 'left';
      g.font = '20px Arial, sans-serif';
      fitText(g, it.name, M + halfW + 80, ry + 38, halfW - 280);
    }

    // Quadros de assinatura na parte inferior direita (9 linhas restantes = 558px)
    const sigAreaY = y + rightItemsH;
    const sigBoxH = ((totalRows - rightItems.length) * rowH) / 2;
    g.beginPath();
    g.moveTo(M + halfW, sigAreaY); g.lineTo(M + CW, sigAreaY);
    g.moveTo(M + halfW, sigAreaY + sigBoxH); g.lineTo(M + CW, sigAreaY + sigBoxH);
    g.stroke();

    g.font = 'bold 21px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('Assinatura do Condutor Diurno', M + halfW + halfW / 2, sigAreaY + 34);
    if (sigDiurnoImg) {
      drawSignatureFit(g, sigDiurnoImg, M + halfW + 40, sigAreaY + 48, halfW - 80, sigBoxH - 95);
    }
    if (d.condutorDiurno) {
      fillTextInk(g, d.condutorDiurno, M + halfW + halfW / 2, sigAreaY + sigBoxH - 16, 'bold 18px Arial, sans-serif');
    }

    g.font = 'bold 21px Arial, sans-serif';
    g.fillText('Assinatura do Condutor Noturno', M + halfW + halfW / 2, sigAreaY + sigBoxH + 34);
    if (sigNoturnoImg) {
      drawSignatureFit(g, sigNoturnoImg, M + halfW + 40, sigAreaY + sigBoxH + 48, halfW - 80, sigBoxH - 95);
    }
    if (d.condutorNoturno) {
      fillTextInk(g, d.condutorNoturno, M + halfW + halfW / 2, sigAreaY + sigBoxH * 2 - 16, 'bold 18px Arial, sans-serif');
    }
    g.textAlign = 'left';

    // PÁGINA 2 (DIAGRAMAS DA VIATURA + LEGENDA + OBSERVAÇÕES DIURNO/NOTURNA)
    const c2 = document.createElement('canvas');
    c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d');
    g2.fillStyle = '#ffffff'; g2.fillRect(0, 0, W, H);
    g2.strokeStyle = '#111111'; g2.fillStyle = '#000000'; g2.lineWidth = 1.8;

    let y2 = 52;
    const diagBoxH = 740;
    g2.strokeRect(M, y2, CW, diagBoxH);
    g2.beginPath(); g2.moveTo(M + halfW, y2); g2.lineTo(M + halfW, y2 + diagBoxH); g2.stroke();

    g2.font = 'bold 23px Arial, sans-serif';
    g2.textAlign = 'center';
    g2.fillText('VISTORIA EXTERNA – DIURNO', M + halfW / 2, y2 + 38);
    g2.fillText('VISTORIA EXTERNA – NOTURNO', M + halfW + halfW / 2, y2 + 38);

    const drawAmbulanceWithMarks = (offsetX, marks) => {
      const ix = offsetX + 28, iy = y2 + 56, iw = halfW - 56, ih = diagBoxH - 125;
      if (ambImg) g2.drawImage(ambImg, ix, iy, iw, ih);
      (marks || []).forEach(mk => {
        const px = ix + mk.x * iw;
        const py = iy + mk.y * ih;
        g2.save();
        g2.fillStyle = '#dc2626';
        g2.strokeStyle = '#ffffff';
        g2.lineWidth = 3;
        g2.beginPath(); g2.arc(px, py, 20, 0, Math.PI * 2); g2.fill(); g2.stroke();
        g2.fillStyle = '#ffffff';
        g2.font = 'bold 18px Arial, sans-serif';
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        g2.fillText(mk.code || 'D', px, py + 1);
        g2.restore();
      });
      g2.font = 'bold 17px Arial, sans-serif';
      g2.fillStyle = '#111111';
      g2.textAlign = 'center';
      g2.fillText('Legenda: A=Amassado  D=Danificado  F=Falta  OK=Normal  Q=Queimado  R=Riscado', offsetX + halfW / 2, y2 + diagBoxH - 22);
    };

    drawAmbulanceWithMarks(M, d.avariasDiurno);
    drawAmbulanceWithMarks(M + halfW, d.avariasNoturno);
    g2.textAlign = 'left';

    y2 += diagBoxH + 38;
    // Observações Diurno (8 linhas)
    const obsRows = 8, obsRowH = 68, obsBoxH = (obsRows + 1) * obsRowH;
    const drawObsBlock = (topY, title, text) => {
      g2.strokeRect(M, topY, CW, obsBoxH);
      g2.font = 'bold 23px Arial, sans-serif';
      g2.fillText(title, M + 16, topY + 44);
      for (let i = 1; i <= obsRows; i++) {
        g2.beginPath(); g2.moveTo(M, topY + i * obsRowH); g2.lineTo(M + CW, topY + i * obsRowH); g2.stroke();
      }
      g2.font = '21px Arial, sans-serif';
      const lines = wrapTextLines(g2, text || '', CW - 32);
      for (let i = 0; i < Math.min(lines.length, obsRows); i++) {
        fillTextInk(g2, lines[i], M + 16, topY + (i + 2) * obsRowH - 16, '21px Arial, sans-serif');
      }
    };

    drawObsBlock(y2, 'Observações Diurno:', d.obsDiurno);
    drawObsBlock(y2 + obsBoxH + 42, 'Observações Noturna:', d.obsNoturno);

    return [c1, c2];
  }

  /* ==========================================================================
   * 3. RENDERIZADOR OFICIAL: CHECK LIST ENFERMAGEM USB (2 PÁGS A4 PAISAGEM)
   * ========================================================================== */
  async function renderEnfermagemCanvases(d) {
    const assets = window.SAMU_ASSETS || {};
    const [samuLogo, orlandiaLogo, sigEnfImg] = await Promise.all([
      loadImg(assets.samu_logo),
      loadImg(assets.orlandia_logo),
      loadImg(d.sigEnfermagem)
    ]);

    const W = 2339, H = 1654, M = 44, CW = W - M * 2;
    const checksDia = d.itensDia || {};
    const checksNoite = d.itensNoite || {};
    const secs = window.SAMU_SCHEMA.enfermagemSections;
    const secById = {};
    secs.forEach(s => { secById[s.id] = s; });

    function drawEnfHeader(g) {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#111111'; g.fillStyle = '#000000'; g.lineWidth = 1.6;
      if (samuLogo) g.drawImage(samuLogo, M + 10, 28, 195, 108);
      if (orlandiaLogo) g.drawImage(orlandiaLogo, W - M - 140, 24, 125, 114);
      g.textAlign = 'center';
      g.font = 'bold 30px Arial, sans-serif';
      g.fillText('SAMU – ORLÂNDIA', W / 2, 68);
      g.font = 'bold 25px Arial, sans-serif';
      g.fillText('CHECAGEM DIÁRIA – UNIDADE DE SUPORTE BÁSICO DE VIDA', W / 2, 112);
      g.textAlign = 'left';
    }

    function drawSectionTable(g, sec, x, y, w, rowH) {
      // Cabeçalho da seção
      g.fillStyle = '#e5e7eb';
      g.fillRect(x, y, w, rowH);
      g.fillStyle = '#000000';
      g.strokeRect(x, y, w, rowH * (sec.items.length + 1));

      const qtyW = 54, ckW = 86;
      const itemW = w - qtyW - ckW * 2;

      g.beginPath();
      g.moveTo(x + qtyW, y + rowH); g.lineTo(x + qtyW, y + rowH * (sec.items.length + 1));
      g.moveTo(x + qtyW + itemW, y); g.lineTo(x + qtyW + itemW, y + rowH * (sec.items.length + 1));
      g.moveTo(x + qtyW + itemW + ckW, y); g.lineTo(x + qtyW + itemW + ckW, y + rowH * (sec.items.length + 1));
      g.stroke();

      g.font = 'bold 17px Arial, sans-serif';
      fitText(g, sec.title, x + 10, y + rowH - 13, qtyW + itemW - 16);
      g.textAlign = 'center';
      g.font = 'bold 15px Arial, sans-serif';
      g.fillText('CK DIA', x + qtyW + itemW + ckW / 2, y + rowH - 14);
      g.fillText('CK NOITE', x + qtyW + itemW + ckW + ckW / 2, y + rowH - 14);

      sec.items.forEach((it, idx) => {
        const ry = y + (idx + 1) * rowH;
        g.beginPath(); g.moveTo(x, ry); g.lineTo(x + w, ry); g.stroke();
        g.font = '17px Arial, sans-serif';
        g.textAlign = 'center';
        g.fillText(it.qty, x + qtyW / 2, ry + rowH - 12);

        fitTextInk(g, checksDia[it.id] || '', x + qtyW + itemW + ckW / 2, ry + rowH - 12, ckW - 8, 'bold 17px Arial, sans-serif');
        fitTextInk(g, checksNoite[it.id] || '', x + qtyW + itemW + ckW + ckW / 2, ry + rowH - 12, ckW - 8, 'bold 17px Arial, sans-serif');

        g.textAlign = 'left';
        g.font = '16px Arial, sans-serif';
        fitText(g, it.name, x + qtyW + 8, ry + rowH - 12, itemW - 14);
      });

      return y + rowH * (sec.items.length + 1);
    }

    function drawEnfFooter(g, obsText, topY) {
      const fh = H - 36 - topY;
      g.strokeRect(M, topY, CW, fh);
      const splitX = M + CW * 0.62;
      g.beginPath(); g.moveTo(splitX, topY); g.lineTo(splitX, topY + fh); g.stroke();

      g.font = 'bold 20px Arial, sans-serif';
      g.fillText('OBS:', M + 14, topY + 30);
      g.font = '19px Arial, sans-serif';
      const lines = wrapTextLines(g, obsText || '', (splitX - M) - 90);
      lines.slice(0, 4).forEach((ln, idx) => {
        fillTextInk(g, ln, M + 76, topY + 30 + idx * 30, '19px Arial, sans-serif');
      });

      g.font = 'bold 20px Arial, sans-serif';
      let fx = splitX + 18;
      g.fillText('DATA: ', fx, topY + 34);
      fx += g.measureText('DATA: ').width;
      const enfDateStr = d.data ? formatDateBR(d.data) : '    /    /      ';
      if (d.data) {
        fillTextInk(g, enfDateStr, fx, topY + 34, 'bold 20px Arial, sans-serif');
      } else {
        g.fillText(enfDateStr, fx, topY + 34);
      }
      fx += g.measureText(enfDateStr).width;
      g.fillText('   |   TURNO: ', fx, topY + 34);
      fx += g.measureText('   |   TURNO: ').width;
      if (d.turno) {
        fillTextInk(g, d.turno, fx, topY + 34, 'bold 20px Arial, sans-serif');
      }
      if (sigEnfImg) {
        drawSignatureFit(g, sigEnfImg, splitX + 80, topY + 42, (M + CW - splitX) - 160, fh - 90);
      }
      const respInfo = [d.responsavelNome, d.responsavelCoren].filter(Boolean).join(' – ');
      g.textAlign = 'center';
      if (respInfo) {
        fitTextInk(g, respInfo, splitX + (M + CW - splitX) / 2, topY + fh - 30, (M + CW - splitX) - 24, 'bold 18px Arial, sans-serif');
      }
      g.font = '16px Arial, sans-serif';
      g.fillText('ASSINATURA E CARIMBO', splitX + (M + CW - splitX) / 2, topY + fh - 10);
      g.textAlign = 'left';
    }

    // PÁGINA 1 (3 colunas de mochilas)
    const c1 = document.createElement('canvas');
    c1.width = W; c1.height = H;
    const g1 = c1.getContext('2d');
    drawEnfHeader(g1);

    const colGap = 16;
    const col3W = (CW - colGap * 2) / 3;
    const rH1 = 47;
    const end1 = drawSectionTable(g1, secById.mochila_verde_clinica, M, 150, col3W, rH1);
    drawSectionTable(g1, secById.mochila_vermelha_trauma, M + col3W + colGap, 150, col3W, rH1);
    const end3a = drawSectionTable(g1, secById.mochila_azul_dago, M + (col3W + colGap) * 2, 150, col3W, rH1);
    const end3b = drawSectionTable(g1, secById.mochila_verde_oxigenio, M + (col3W + colGap) * 2, end3a + 14, col3W, rH1);
    drawEnfFooter(g1, d.obsPagina1, Math.max(end1, end3b) + 18);

    // PÁGINA 2 (4 colunas: Viatura | Gaveta 1 + Gaveta 2 + Bolsa Sinais VT | Armário Superior | Bolsa Punção)
    const c2 = document.createElement('canvas');
    c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d');
    drawEnfHeader(g2);

    const col4W = (CW - colGap * 3) / 4;
    const rH2 = 43;
    const p2e1 = drawSectionTable(g2, secById.viatura_enf, M, 148, col4W, rH2);
    const p2g1 = drawSectionTable(g2, secById.gaveta_1, M + col4W + colGap, 148, col4W, rH2);
    const p2g2 = drawSectionTable(g2, secById.gaveta_2, M + col4W + colGap, p2g1 + 12, col4W, rH2);
    const p2bs = drawSectionTable(g2, secById.bolsa_sinais_vt, M + col4W + colGap, p2g2 + 12, col4W, rH2);
    const p2as = drawSectionTable(g2, secById.armario_superior, M + (col4W + colGap) * 2, 148, col4W, rH2);
    drawSectionTable(g2, secById.bolsa_puncao, M + (col4W + colGap) * 3, 148, col4W, rH2);

    drawEnfFooter(g2, d.obsPagina2, Math.max(p2e1, p2bs, p2as) + 16);

    return [c1, c2];
  }

  /* ==========================================================================
   * EMPACOTADOR NATIVO PDF 1.4 MULTIPÁGINA (ZERO DEPENDÊNCIAS EXTERNAS)
   * ========================================================================== */
  function asciiBytes(str) {
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
    return arr;
  }

  function dataUrlToUint8(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function uint8ToBase64(bytes) {
    const chunkSize = 0x8000;
    const parts = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
    }
    return btoa(parts.join(''));
  }

  function buildPdfFromCanvases(canvases, isLandscape) {
    const pageW = isLandscape ? 841.89 : 595.28;
    const pageH = isLandscape ? 595.28 : 841.89;

    const chunks = [];
    let offset = 0;
    const offsets = {};

    const pushStr = (s) => {
      const b = asciiBytes(s);
      chunks.push(b);
      offset += b.byteLength;
    };
    const pushBin = (b) => {
      chunks.push(b);
      offset += b.byteLength;
    };

    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    // Obj 1: Catalog
    offsets[1] = offset;
    pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    const pageObjIds = canvases.map((_, idx) => 3 + idx * 3);

    // Obj 2: Pages
    offsets[2] = offset;
    pushStr(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map(id => id + ' 0 R').join(' ')}] /Count ${canvases.length} >>\nendobj\n`);

    canvases.forEach((cv, idx) => {
      const pageId = 3 + idx * 3;
      const contentId = 4 + idx * 3;
      const imgId = 5 + idx * 3;

      const jpegDataUrl = cv.toDataURL('image/jpeg', 0.90);
      const jpegBytes = dataUrlToUint8(jpegDataUrl);

      offsets[pageId] = offset;
      pushStr(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

      const streamCmd = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
      offsets[contentId] = offset;
      pushStr(`${contentId} 0 obj\n<< /Length ${streamCmd.length} >>\nstream\n${streamCmd}\nendstream\nendobj\n`);

      offsets[imgId] = offset;
      pushStr(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\nstream\n`);
      pushBin(jpegBytes);
      pushStr('\nendstream\nendobj\n');
    });

    const totalObjs = 2 + canvases.length * 3;
    const xrefStart = offset;
    pushStr(`xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= totalObjs; id++) {
      pushStr(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    }
    pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    const finalBytes = new Uint8Array(offset);
    let pos = 0;
    for (const c of chunks) {
      finalBytes.set(c, pos);
      pos += c.byteLength;
    }

    return {
      bytes: finalBytes,
      base64: uint8ToBase64(finalBytes)
    };
  }

  async function renderCanvasesForRecord(record) {
    const type = record.type || 'ficha';
    const data = record.data || {};
    if (type === 'checklist_condutor') {
      return { canvases: await renderCondutorCanvases(data), landscape: false };
    }
    if (type === 'checklist_enfermagem') {
      return { canvases: await renderEnfermagemCanvases(data), landscape: true };
    }
    return { canvases: await renderFichaCanvases(data), landscape: false };
  }

  async function generatePdfForRecord(record) {
    const rendered = await renderCanvasesForRecord(record);
    const pdf = buildPdfFromCanvases(rendered.canvases, rendered.landscape);
    return {
      canvases: rendered.canvases,
      landscape: rendered.landscape,
      bytes: pdf.bytes,
      base64: pdf.base64
    };
  }

  function buildFileName(record) {
    const d = String(record.date || '').replace(/\//g, '-') || new Date().toISOString().slice(0, 10);
    const clean = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (record.type === 'checklist_condutor') {
      return `CheckList_Condutor_${d}_${clean(record.vehicle || 'USB')}.pdf`;
    }
    if (record.type === 'checklist_enfermagem') {
      return `CheckList_Enfermagem_${d}_${clean(record.createdByName || 'USB')}.pdf`;
    }
    return `Ficha_SAMU_${d}_${clean(record.patientName || 'Paciente')}.pdf`;
  }

  async function downloadOrSharePdf(record, preGenerated) {
    const gen = preGenerated || await generatePdfForRecord(record);
    const fileName = buildFileName(record);

    if (window.AndroidBridge && typeof window.AndroidBridge.sharePdf === 'function') {
      window.AndroidBridge.sharePdf(gen.base64, fileName);
      return;
    }

    const blob = new Blob([gen.bytes], { type: 'application/pdf' });
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: fileName });
          return;
        }
      } catch (eShare) {}
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function printRecord(record, preGenerated) {
    const gen = preGenerated || await generatePdfForRecord(record);
    const fileName = buildFileName(record);

    if (window.AndroidBridge && typeof window.AndroidBridge.printPdf === 'function') {
      window.AndroidBridge.printPdf(gen.base64, fileName, Boolean(gen.landscape));
      return;
    }

    // No navegador PC/Mobile: abre janela de impressão limpa com as páginas A4 exatas
    const imgsHtml = gen.canvases.map(cv =>
      `<div class="print-page"><img src="${cv.toDataURL('image/jpeg', 0.94)}" /></div>`
    ).join('');

    const w = window.open('', '_blank');
    if (!w) {
      await downloadOrSharePdf(record, gen);
      return;
    }
    const pageCssSize = gen.landscape ? 'A4 landscape' : 'A4 portrait';
    w.document.write(`<!DOCTYPE html>
      <html><head><title>${fileName}</title>
      <style>
        @page { size: ${pageCssSize}; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        .print-page { page-break-after: always; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
        .print-page:last-child { page-break-after: auto; }
        img { max-width: 100%; max-height: 100%; object-fit: contain; }
      </style></head>
      <body>${imgsHtml}
      <script>
        window.onload = function() { setTimeout(function() { window.print(); }, 250); };
      <\/script></body></html>`);
    w.document.close();
  }

  /* ==========================================================================
   * RECORTE DA FOTO DO CABEÇALHO + HORÁRIOS P/ REGULAÇÃO MÉDICA (WHATSAPP)
   * ========================================================================== */
  async function generateFichaRegulacaoHeaderImage(record) {
    const data = (record && record.data) ? record.data : (record || {});
    const pages = await renderFichaCanvases(data);
    const c1 = pages[0];
    const cropTop = 18;
    const cropBottom = Math.min(c1.height, c1.__regCropBottomY || 762);
    const cropW = c1.width;
    const cropH = Math.max(200, cropBottom - cropTop);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const ctx = cropCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cropW, cropH);
    ctx.drawImage(c1, 0, cropTop, cropW, cropH, 0, 0, cropW, cropH);

    const jpegDataUrl = cropCanvas.toDataURL('image/jpeg', 0.94);
    const jpegBase64 = jpegDataUrl.split(',')[1] || '';

    const rawDate = String((record && record.date) || data.data || '').replace(/\//g, '-') || new Date().toISOString().slice(0, 10);
    const cleanName = String((record && record.patientName) || data.vitimaNome || 'Ocorrencia')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || 'Ocorrencia';
    const fileName = `Cabecalho_Regulacao_SAMU_${rawDate}_${cleanName}.jpg`;

    const dateBR = formatDateBR(data.data || (record && record.date) || '');
    const hChamado = (data.horarios && data.horarios.horaChamado) ? ` • Chamado: ${data.horarios.horaChamado}` : '';
    const vNome = data.vitimaNome || 'Em identificação';
    const riscoTxt = data.risco ? ` • Risco: ${data.risco}` : '';
    const caption = `🚑 *SAMU 192 – Orlândia-SP (Cabeçalho p/ Regulação Médica)*\n📅 Data: ${dateBR}${hChamado}\n👤 Vítima: ${vNome}${riscoTxt}`;

    return {
      canvas: cropCanvas,
      dataUrl: jpegDataUrl,
      base64: jpegBase64,
      fileName,
      caption
    };
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',');
    const mimeMatch = (parts[0] || '').match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bin = atob(parts[1] || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function downloadRegulacaoHeaderJpg(record, preGenerated) {
    const img = preGenerated || await generateFichaRegulacaoHeaderImage(record);
    const blob = dataUrlToBlob(img.dataUrl);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = img.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return img;
  }

  async function copyRegulacaoHeaderToClipboard(preGenerated) {
    if (!preGenerated || !preGenerated.canvas) throw new Error('Imagem não gerada.');
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      throw new Error('Área de transferência de imagem indisponível neste navegador.');
    }
    const pngBlob = await new Promise((resolve) => preGenerated.canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('Falha ao converter imagem.');
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': pngBlob })]);
    return true;
  }

  async function shareRegulacaoHeaderWhatsApp(record, preGenerated) {
    const img = preGenerated || await generateFichaRegulacaoHeaderImage(record);

    // 1. No APK Nativo Android: abre o WhatsApp direto já com a foto recortada e a legenda anexadas!
    if (window.AndroidBridge && typeof window.AndroidBridge.shareImageToWhatsApp === 'function') {
      window.AndroidBridge.shareImageToWhatsApp(img.base64, img.fileName, img.caption);
      return { mode: 'android_whatsapp', img };
    }

    // 2. Navegador Mobile c/ suporte a Web Share de arquivos
    const blob = dataUrlToBlob(img.dataUrl);
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], img.fileName, { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Cabeçalho SAMU 192 – Regulação Médica',
            text: img.caption
          });
          return { mode: 'web_share', img };
        }
      } catch (eShare) {
        if (eShare && eShare.name === 'AbortError') {
          return { mode: 'aborted', img };
        }
      }
    }

    // 3. No Simulador PC: tenta copiar a imagem p/ área de transferência (Ctrl+V no WhatsApp Web) e baixa o .JPG
    let copied = false;
    try {
      await copyRegulacaoHeaderToClipboard(img);
      copied = true;
    } catch (eClip) {}

    await downloadRegulacaoHeaderJpg(record, img);
    return { mode: copied ? 'pc_copied_and_downloaded' : 'pc_downloaded', img };
  }

  window.SamuPDF = {
    renderCanvasesForRecord,
    generatePdfForRecord,
    generateFichaRegulacaoHeaderImage,
    shareRegulacaoHeaderWhatsApp,
    downloadRegulacaoHeaderJpg,
    copyRegulacaoHeaderToClipboard,
    buildFileName,
    downloadOrSharePdf,
    printRecord
  };
})();
