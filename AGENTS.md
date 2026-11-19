# AGENTS.md (Codex)

Bu proje Claude Code ve Codex tarafından sırayla geliştirilir. Kurallar tek yerde tutulur:

1. **Önce `CLAUDE.md` dosyasını oku ve aynen uygula.** Oradaki kurallar (yalnız kayar otomat, veri uydurma yok, onay beklemeden düzeltme yok, katman ayrımı, Türkçe yanıt) Codex için de geçerlidir.
2. **Sonra `docs/DEVAM.md` dosyasını oku.** Son durum, yarım kalan iş ve sıradaki adım oradadır.
3. İş bitince ya da limit dolmadan önce `docs/DEVAM.md` dosyasını güncelle: ne yapıldı, hangi dosyalar değişti, test sonucu, sıradaki adım.
4. `../örnek cam dosyaları/` içeriğini repoya kopyalama. Kullanıcı istemeden commit/push yapma. Geliştirme sunucusunu istenmeden açma.
5. Bitirmeden önce: `npx vitest run` ve `node tests/realprograms.mjs`.

## Göreve göre kod haritası

- Göreve başlamadan önce `docs/VOLKAN_KOD_HARITASI.md` içinden ilgili akışı seç. Volkan varsa görev için dar bir okuma ve test listesi iste. Ajanlara görev, kabul ölçütü ve ilgili dosyaları ver. Aramayı yalnız eksik bir bağımlılık bulunduğunda genişlet.
