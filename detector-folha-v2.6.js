/* Detector leve de folha — v2.6. Sem bibliotecas externas.
 * Detecta um retângulo de papel claro em fundo escuro, inclusive papel acinzentado
 * e sombras internas. Não faz OCR, não identifica dados do documento.
 * Não envia imagens pela rede. A análise ocorre somente no dispositivo.
 * Interface pública: SGBDetectorFolhaV26.analisarVideo(video[, opcoes])
 * ou SGBDetectorFolhaV26.criarMonitor(video, callback[, opcoes]).
 */
(function (root) {
  'use strict';
  const LARGURA = 180;
  const ALTURA = 252;

  function limitar(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function otsu(gray) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const n = gray.length;
    let soma = 0;
    for (let i = 0; i < 256; i++) soma += i * hist[i];
    let w0 = 0, s0 = 0, maior = -1, limiar = 100;
    for (let t = 0; t < 256; t++) {
      w0 += hist[t]; s0 += t * hist[t];
      if (!w0 || w0 === n) continue;
      const w1 = n - w0;
      const diff = s0 / w0 - (soma - s0) / w1;
      const entre = w0 * w1 * diff * diff;
      if (entre > maior) { maior = entre; limiar = t; }
    }
    return limiar;
  }

  function analisarPixels(pixels, largura, altura, opcoes) {
    opcoes = opcoes || {};
    const total = largura * altura;
    if (largura < 50 || altura < 65 || !pixels || pixels.length < total * 4) {
      return { enquadrado: false, motivo: 'Imagem indisponível', confianca: 0 };
    }
    const gray = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const j = 4 * i;
      gray[i] = (pixels[j] * 77 + pixels[j + 1] * 150 + pixels[j + 2] * 29) >> 8;
    }
    const limiar = otsu(gray);
    const mask = new Uint8Array(total);
    // Evita deixar a moldura, se houver, ser confundida com a folha.
    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        const i = y * largura + x;
        mask[i] = gray[i] > limiar ? 1 : 0;
      }
    }
    const visto = new Uint8Array(total);
    const fila = new Int32Array(total);
    let melhor = null;
    // Componentes de pixels claros contíguos; pequenas letras e sombras não
    // precisam ser brancas para que as bordas do papel sejam detectadas.
    for (let p = 0; p < total; p++) {
      if (!mask[p] || visto[p]) continue;
      let cabeca = 0, cauda = 1;
      fila[0] = p; visto[p] = 1;
      let xmin = largura, xmax = 0, ymin = altura, ymax = 0, soma = 0;
      while (cabeca < cauda) {
        const idx = fila[cabeca++];
        const y = (idx / largura) | 0, x = idx - y * largura;
        xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        soma++;
        // 4 conexões são suficientes para região clara dominante.
        if (x > 0 && mask[idx-1] && !visto[idx-1]) {visto[idx-1]=1;fila[cauda++]=idx-1;}
        if (x+1 < largura && mask[idx+1] && !visto[idx+1]) {visto[idx+1]=1;fila[cauda++]=idx+1;}
        if (y > 0 && mask[idx-largura] && !visto[idx-largura]) {visto[idx-largura]=1;fila[cauda++]=idx-largura;}
        if (y+1 < altura && mask[idx+largura] && !visto[idx+largura]) {visto[idx+largura]=1;fila[cauda++]=idx+largura;}
      }
      if (!melhor || soma > melhor.area) melhor = { x:xmin,y:ymin,w:xmax-xmin+1,h:ymax-ymin+1,area:soma };
    }
    if (!melhor) return { enquadrado:false, motivo:'Aproxime a folha e melhore a iluminação', confianca:0, limiar };
    const b = melhor;
    const areaFracao = b.area / total;
    const larguraFracao = b.w / largura;
    const alturaFracao = b.h / altura;
    const proporcao = b.w / b.h;
    const solidez = b.area / (b.w * b.h);
    const centroX = (b.x + b.w/2) / largura;
    const centroY = (b.y + b.h/2) / altura;
    const margem = opcoes.margem === undefined ? 0.035 : limitar(Number(opcoes.margem),0.01,0.15);
    const cabendo = b.x >= margem * largura && b.y >= margem * altura &&
      b.x+b.w <= largura*(1-margem) && b.y+b.h <= altura*(1-margem);
    const centralizado = Math.abs(centroX-.5) < .17 && Math.abs(centroY-.5) < .17;
    // Esta combinação dá peso ao formato e tamanho, NÃO à brancura absoluta.
    const geometria = proporcao >= .54 && proporcao <= .90 &&
      larguraFracao >= .50 && alturaFracao >= .55 &&
      areaFracao >= .24 && solidez >= .43;
    // Mede contraste ao lado de cada borda, não no miolo (onde há texto/sombra).
    const faixa = Math.max(2, Math.floor(Math.min(largura, altura) * .02));
    let dentro = 0, fora = 0, n = 0;
    for (let a = 0.14; a <= 0.86; a += 0.12) {
      const y = limitar(Math.round(b.y + b.h*a),0,altura-1);
      const x = limitar(Math.round(b.x + b.w*a),0,largura-1);
      if (b.x >= faixa+2 && b.x+b.w+faixa < largura) {
        dentro += gray[y*largura+limitar(b.x+faixa,0,largura-1)];
        fora += gray[y*largura+limitar(b.x-faixa,0,largura-1)];n++;
        dentro += gray[y*largura+limitar(b.x+b.w-1-faixa,0,largura-1)];
        fora += gray[y*largura+limitar(b.x+b.w-1+faixa,0,largura-1)];n++;
      }
      if (b.y >= faixa+2 && b.y+b.h+faixa < altura) {
        dentro += gray[limitar(b.y+faixa,0,altura-1)*largura+x];
        fora += gray[limitar(b.y-faixa,0,altura-1)*largura+x];n++;
        dentro += gray[limitar(b.y+b.h-1-faixa,0,altura-1)*largura+x];
        fora += gray[limitar(b.y+b.h-1+faixa,0,altura-1)*largura+x];n++;
      }
    }
    const contrasteBordas = n ? (dentro - fora) / n : 0;
    const contrasteOK = n >= 10 && contrasteBordas >= (opcoes.contrasteMinimo === undefined ? 8 : Number(opcoes.contrasteMinimo));
    const aceito = cabendo && centralizado && geometria && contrasteOK;
    let motivo = 'Folha enquadrada. Mantenha imóvel.';
    if (!cabendo) motivo = 'Afaste um pouco: mostre as quatro bordas da folha.';
    else if (!centralizado) motivo = 'Centralize a folha no quadro.';
    else if (!geometria) motivo = 'Mostre a folha inteira em formato vertical.';
    else if (!contrasteOK) motivo = 'Melhore a luz ou use fundo mais escuro.';
    const confianca = limitar(Math.round((geometria ? 40 : 0)+(cabendo?22:0)+
      (centralizado?13:0)+(contrasteOK?25:0)),0,100);
    return {enquadrado:aceito, motivo, confianca, limiar, contrasteBordas:Math.round(contrasteBordas*10)/10,
      ocupacao:Math.round(areaFracao*100), solidez:Math.round(solidez*100),
      retangulo:{x:b.x/largura, y:b.y/altura, largura:b.w/largura, altura:b.h/altura}};
  }

  function canvasParaVideo(video, canvas, width, height) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return false;
    let sx=0,sy=0,sw=vw,sh=vh;
    // corresponde a um vídeo em object-fit: cover no quadro vertical.
    if (vw/vh > width/height) {sw=vh*width/height;sx=(vw-sw)/2;}
    else {sh=vw*height/width;sy=(vh-sh)/2;}
    canvas.width=width;canvas.height=height;
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(video,sx,sy,sw,sh,0,0,width,height);
    return true;
  }
  let canvas;
  function analisarVideo(video, opcoes) {
    if (!video) return {enquadrado:false,motivo:'Câmera não localizada',confianca:0};
    canvas = canvas || document.createElement('canvas');
    if (!canvasParaVideo(video, canvas, LARGURA, ALTURA)) return {enquadrado:false,motivo:'Aguardando a câmera',confianca:0};
    const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,LARGURA,ALTURA).data;
    return analisarPixels(pixels,LARGURA,ALTURA,opcoes);
  }
  function criarMonitor(video, callback, opcoes) {
    opcoes=opcoes||{};
    const periodo=Math.max(180,Number(opcoes.intervaloMs)||250);
    const historico=[];
    let ativo=true, timer=null;
    function executar() {
      if (!ativo) return;
      let resultado;
      try {resultado=analisarVideo(video,opcoes);} catch(e) {resultado={enquadrado:false,motivo:'Falha ao analisar câmera',erro:String(e.message),confianca:0};}
      historico.push(Boolean(resultado.enquadrado));
      if (historico.length>5) historico.shift();
      const confirmados=historico.filter(Boolean).length;
      callback(Object.assign({},resultado,{estavel:confirmados>=3 && resultado.enquadrado,amostrasValidas:confirmados}));
      timer=setTimeout(executar,periodo);
    }
    executar();
    return {parar:function(){ativo=false;clearTimeout(timer);},reiniciar:function(){historico.length=0;}};
  }
  const api={versao:'2.6',analisarPixels,analisarVideo,criarMonitor};
  root.SGBDetectorFolhaV26=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
