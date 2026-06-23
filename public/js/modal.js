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
        if (a.onClick) a.onClick();
        if (a.close !== false) this.close();
      });
    });

    container.appendChild(overlay);
    return overlay;
  },

  close() {
    const container = document.getElementById('modalContainer');
    container.innerHTML = '';
  },

  // Promise-based confirmation dialog. Resolves to true if the user
  // confirms, false if they cancel or close the overlay. Body may be a
  // string (wrapped in a <p>) or arbitrary HTML.
  confirm({ title = 'Confirm', body = '', okLabel = 'Confirm', cancelLabel = 'Cancel', okClass = 'btn-primary' } = {}) {
    return new Promise(resolve => {
      const content = typeof body === 'string' && !body.trim().startsWith('<')
        ? `<p style="line-height:1.6;color:var(--text-primary)">${body}</p>`
        : body;
      // Build manually so we can intercept close() and prevent the
      // standard auto-close from racing with our resolve.
      const container = document.getElementById('modalContainer');
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content">
          <h3>${title}</h3>
          <div class="modal-body">${content}</div>
          <div class="modal-actions">
            <button class="btn btn-secondary" data-confirm="0">${cancelLabel}</button>
            <button class="btn ${okClass}" data-confirm="1">${okLabel}</button>
          </div>
        </div>
      `;
      const finish = (val) => {
        container.innerHTML = '';
        resolve(val);
      };
      overlay.querySelectorAll('[data-confirm]').forEach(btn => {
        btn.addEventListener('click', () => finish(btn.getAttribute('data-confirm') === '1'));
      });
      overlay.querySelector('.modal-overlay').addEventListener('click', () => finish(false));
      container.appendChild(overlay);
    });
  }
};
