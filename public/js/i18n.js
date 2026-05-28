const I18n = {
  currentLang: 'zh-CN',
  translations: {},

  async init() {
    const saved = localStorage.getItem('jewel-lang');
    if (saved) this.currentLang = saved;
    await this.loadLang(this.currentLang);
  },

  async loadLang(lang) {
    if (this.translations[lang]) return;
    try {
      const res = await fetch(`/lang/${lang}.json`);
      this.translations[lang] = await res.json();
    } catch {
      this.translations[lang] = {};
    }
  },

  async setLang(lang) {
    this.currentLang = lang;
    localStorage.setItem('jewel-lang', lang);
    await this.loadLang(lang);
    this.apply();
    document.querySelectorAll('#langSelect').forEach(sel => sel.value = lang);
  },

  t(key) {
    const dict = this.translations[this.currentLang] || {};
    return dict[key] || key;
  },

  apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = this.t(key);
      if (text !== key) el.textContent = text;
    });
  }
};
