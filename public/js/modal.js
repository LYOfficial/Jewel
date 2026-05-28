const Modal = {
  show(title, content, actions = []) {
    const container = document.getElementById('modalContainer');
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-overlay" data-close></div>
      <div class="modal-content">
        <h3>${title}</h3>
        <div class="modal-body">${content}</div>
        ${actions.length ? `<div class="modal-actions">${actions.map((a, i) =>
          `<button class="btn ${a.class || ''}" data-action="${i}">${a.label}</button>`
        ).join('')}</div>` : ''}
      </div>
    `;

    overlay.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => this.close());
    });

    actions.forEach((a, i) => {
      overlay.querySelector(`[data-action="${i}"]`).addEventListener('click', () => {
        a.onClick();
        if (a.close !== false) this.close();
      });
    });

    container.appendChild(overlay);
    return overlay;
  },

  close() {
    const container = document.getElementById('modalContainer');
    container.innerHTML = '';
  }
};
