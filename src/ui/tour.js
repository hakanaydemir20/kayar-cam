// Yardım turu: ekranın bölümlerini iş sırasına göre vurgular, açıklama balonuyla anlatır (İleri / Geri / Kapat).

const STEPS = [
  { el: null, title: 'Kayar CAM’e hoş geldiniz', text: 'Bu tur, ekranın her bölümünü işin sırasıyla anlatır: <b>parçayı aç → bağlama ve sıfır → işlemler → simülasyon → NC kodu</b>. İstediğiniz an <kbd>Esc</kbd> ile kapatabilirsiniz.' },
  { el: '#btnOpen', title: '1 · Parçayı açın', text: '<b>Aç</b> menüsünden 3D parça (STEP veya OBJ) açın, hazır bir G-kod dosyasını simüle edin, boş bir program yazın ya da kayıtlı projenize dönün.' },
  { el: '#sbPart', title: '2 · Parça', text: 'Açık parçanın adı, boyu, çubuk çapı ve sıfır noktası burada görünür. Tıklayınca <b>Parça</b> penceresi açılır: profil veya çizim, özellikler (delik, diş, düzlük…), Z0 ve çubuk ayarları. Ön yüzü ve referansı <b>Bağlama</b> düğmesiyle değiştirirsiniz.' },
  { el: '#btnTools', title: '3 · Takımlar', text: 'Makinedeki takımların listesi. Bir takıma tıklayınca ayarları açılır: tornalama katerinde <b>elmas (kesici uç) tipini</b> seçebilir ya da ISO kodunu (ör. VCMT 110304) yazabilirsiniz.' },
  { el: '.ops-group', title: '4 · İşlemler (takım yolları)', text: 'Program sırası yukarıdan aşağıya doğrudur. <b>$1</b> ana iş mili, <b>$2</b> karşı iş milidir. Kartı tıklayınca parametreler açılır; sürükleyerek sırayı değiştirebilir, anahtarla işlemi kapatabilirsiniz.' },
  { el: '#btnAddOp', title: '5 · İşlem ekleyin', text: 'Sol menünün üstündeki bu düğmeyle tornalama, delme, frezeleme veya karşı mil işlemi eklenir. Yeni işlem doğru sıraya kendiliğinden yerleşir.' },
  { el: '#btnRough', title: '5b · Kaba otomatik', text: 'Kaba tornalama penceresi: malzeme, takım, en fazla paso, ilerleme ve devir sorulur, takıma ve malzemeye göre değerler önerilir. Elmasın erişemediği bölgeler gösterilir, taretteki uygun takım ya da kanal takımı önerilir.' },
  { el: '#centerPanel', title: '6 · Simülasyon', text: 'Makineye gidecek G-kodun kendisi burada oynatılır. Fareyle döndürün (sol tuş), kaydırın (sağ tuş), yakınlaşın (tekerlek).' },
  { el: '#segView', title: '7 · 3D veya 2D', text: '<b>3D</b> makine görünümü ile <b>2D</b> kesit grafiği arasında geçiş. 2D’de stok, hedef parça, takım yolu ve takım silueti ölçülü görünür. Kısayol: <kbd>2</kbd> / <kbd>3</kbd>.' },
  { el: '#mView', title: '8 · Görünüm', text: 'Makine iç yapısı, dış kaporta, takımlar, takım yolları, eksen göstergesi gibi ekranda neyin görüneceğini buradan hızlıca seçin.' },
  { el: '#player', title: '9 · Oynatma', text: 'Oynat / duraklat (<kbd>Boşluk</kbd>), satır satır ileri-geri (<kbd>←</kbd> <kbd>→</kbd>), hız ve zaman çubuğu.' },
  { el: '#pane-code', title: '10 · G-kod', text: 'Oynayan satır vurgulanır. Kodu <b>elle yazabilir, kopyalayıp yapıştırabilirsiniz</b>. Yazdıkça hareket çizilir; <kbd>Enter</kbd> (EOB) biten satırı oynatır.' },
  { el: '#rtabs', title: '11 · Uyarılar, zamanlama, kontrol', text: '<b>Uyarılar</b>: hata ve uyarıların listesi (tıklayınca yerine gider). <b>Zamanlama</b>: iki kanalın zaman çizelgesi. <b>Kontrol</b>: fazla kesim, kalan malzeme ve çarpışma sonucu.' },
  { el: '#statusPill', title: '12 · Durum', text: 'Yeşil: hata yok, simülasyon doğrulandı. Sarı: hesaplanıyor. Kırmızı: sorun var; ayrıntı Uyarılar sekmesinde.' },
  { el: '#btnOutput', title: '13 · NC kodu', text: 'Kontrol özeti ve <b>NC kodunu indir</b>. Hata, çarpışma ya da fazla kesim varsa indirme kilitlidir. İlk denemeyi makinede kuru çalıştırma / tek blok ile yapın.' },
  { el: '#btnSettings', title: '14 · Ayarlar', text: 'Görünüm, simülasyon, G-kod editörü ve arayüz ayarları kategorilere ayrılmıştır. Post-processor ve makine limitleri de buradadır.' },
  { el: '#btnHelp', title: 'Hazırsınız', text: 'Bu turu istediğiniz zaman <b>?</b> düğmesiyle yeniden açabilirsiniz. İyi çalışmalar!' },
];

export class Tour {
  constructor() { this.i = 0; this.onKey = (e) => this.key(e); }
  start(i = 0) {
    this.stop();
    this.i = i;
    this.mask = document.createElement('div'); this.mask.className = 'tour-mask';
    this.ring = document.createElement('div'); this.ring.className = 'tour-ring';
    this.tip = document.createElement('div'); this.tip.className = 'tour-tip'; this.tip.setAttribute('role', 'dialog');
    document.body.append(this.mask, this.ring, this.tip);
    this.mask.addEventListener('click', () => this.stop());
    window.addEventListener('keydown', this.onKey, true);
    this.ro = () => this.place();
    window.addEventListener('resize', this.ro);
    this.show();
  }
  stop() {
    for (const e of [this.mask, this.ring, this.tip]) e?.remove();
    this.mask = this.ring = this.tip = null;
    window.removeEventListener('keydown', this.onKey, true);
    if (this.ro) window.removeEventListener('resize', this.ro);
  }
  key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.stop(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); this.go(-1); }
  }
  go(d) {
    const n = this.i + d;
    if (n >= STEPS.length) { this.stop(); return; }
    if (n < 0) return;
    this.i = n; this.show();
  }
  show() {
    const s = STEPS[this.i];
    const last = this.i === STEPS.length - 1;
    this.tip.innerHTML = `<div class="tt-head"><span class="tt-no">${this.i + 1} / ${STEPS.length}</span><button class="tt-x" aria-label="Turu kapat">✕</button></div>
      <h4>${s.title}</h4><p>${s.text}</p>
      <div class="tt-dots">${STEPS.map((_, k) => `<i class="${k === this.i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tt-nav"><button class="btn ghost tt-prev" ${this.i ? '' : 'disabled'}>← Geri</button><button class="btn pri tt-next">${last ? 'Bitir' : 'İleri →'}</button></div>`;
    this.tip.querySelector('.tt-x').onclick = () => this.stop();
    this.tip.querySelector('.tt-prev').onclick = () => this.go(-1);
    this.tip.querySelector('.tt-next').onclick = () => this.go(1);
    this.place();
    this.tip.querySelector('.tt-next').focus({ preventScroll: true });
  }
  place() {
    if (!this.tip) return;
    const s = STEPS[this.i];
    const el = s.el && document.querySelector(s.el);
    const r0 = el && el.getBoundingClientRect();
    // vurgu ekrana sığsın (uzun listeler)
    const r = r0 && (() => { const l = Math.max(4, r0.left), t = Math.max(4, r0.top), rr = Math.min(window.innerWidth - 4, r0.right), b = Math.min(window.innerHeight - 4, r0.bottom); return { left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t }; })();
    const W = window.innerWidth, H = window.innerHeight, tw = Math.min(360, W - 24);
    this.tip.style.width = tw + 'px';
    if (!r || !r.width) {
      this.ring.style.display = 'none'; this.mask.classList.add('full');
      this.tip.style.left = (W - tw) / 2 + 'px'; this.tip.style.top = Math.max(20, H / 2 - 120) + 'px';
      this.tip.dataset.side = 'none';
      return;
    }
    this.mask.classList.remove('full');
    const pad = 6;
    Object.assign(this.ring.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const th = this.tip.offsetHeight || 200, gap = 14;
    // yer: altta → üstte → sağda → solda (ekrana sığan ilk)
    let x, y, side;
    if (r.bottom + gap + th < H) { side = 'bottom'; y = r.bottom + gap; x = r.left + r.width / 2 - tw / 2; }
    else if (r.top - gap - th > 0) { side = 'top'; y = r.top - gap - th; x = r.left + r.width / 2 - tw / 2; }
    else if (r.right + gap + tw < W) { side = 'right'; x = r.right + gap; y = r.top + r.height / 2 - th / 2; }
    else { side = 'left'; x = r.left - gap - tw; y = r.top + r.height / 2 - th / 2; }
    if (side === 'bottom' && r.height > H * 0.5) { side = 'inside'; y = r.top + 60; }
    x = Math.max(12, Math.min(W - tw - 12, x)); y = Math.max(12, Math.min(H - th - 12, y));
    this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
    this.tip.dataset.side = side;
  }
}
