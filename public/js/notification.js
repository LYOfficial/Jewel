const Notify = {
  timer: null,

  show(message, type = 'info', duration = 3000) {
    const el = document.getElementById('notification');
    if (!el) return;
    el.textContent = message;
    el.className = `notification ${type}`;
    requestAnimationFrame(() => el.classList.add('show'));

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      el.classList.remove('show');
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error', 5000); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg) { this.show(msg, 'info'); }
};
