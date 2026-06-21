const Images = {
  refreshTimer: null,
  data: { images: [], totals: null },

  async render(container) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title" data-i18n="images.list">镜像列表</div>
          <div class="topbar-actions">
            <span id="imagesSummary" style="color:var(--text-muted);font-size:12px"></span>
            <button class="btn btn-sm" id="refreshImages" data-i18n="common.refresh">刷新</button>
            <button class="btn btn-sm btn-danger" id="pruneImagesBtn" data-i18n="images.pruneAll">一键删除未使用</button>
          </div>
        </div>
        <div id="imagesList" class="table-container"></div>
      </div>
    `;
    I18n.apply();

    document.getElementById('refreshImages').addEventListener('click', () => this.loadList());
    document.getElementById('pruneImagesBtn').addEventListener('click', () => this.confirmPrune());

    await this.loadList();
    this.refreshTimer = setInterval(() => this.loadList(), 30000);
  },

  destroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  },

  async loadList() {
    try {
      const data = await API.getImages(true);
      this.data = data || { images: [], totals: null };
      this.renderTable();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  renderTable() {
    const el = document.getElementById('imagesList');
    const summary = document.getElementById('imagesSummary');
    const totals = this.data.totals || { count: 0, inUseCount: 0, unusedCount: 0, totalSize: 0, unusedSize: 0 };

    if (summary) {
      summary.textContent = I18n.t('images.summary')
        ? I18n.t('images.summary')
            .replace('{total}', totals.count)
            .replace('{inUse}', totals.inUseCount)
            .replace('{unused}', totals.unusedCount)
            .replace('{unusedSize}', formatBytes(totals.unusedSize || 0))
        : `共 ${totals.count} 个，${totals.inUseCount} 个使用中，${totals.unusedCount} 个未使用（${formatBytes(totals.unusedSize || 0)}）`;
    }

    if (!this.data.images || this.data.images.length === 0) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon"><img src="/img/icons/images.svg" alt="" style="width:48px;height:48px;opacity:0.3;filter:invert(1)"></div>
        <p data-i18n="images.noImages">暂无镜像</p>
      </div>`;
      I18n.apply();
      return;
    }

    el.innerHTML = `<table>
      <thead><tr>
        <th data-i18n="images.id">ID</th>
        <th data-i18n="images.repoTags">仓库 / 标签</th>
        <th data-i18n="images.size">大小</th>
        <th data-i18n="images.created">创建时间</th>
        <th data-i18n="images.usage">使用情况</th>
        <th data-i18n="images.actions">操作</th>
      </tr></thead>
      <tbody>${this.data.images.map(img => this.renderRow(img)).join('')}</tbody>
    </table>`;
    I18n.apply();
  },

  renderRow(img) {
    const tags = (img.RepoTags || []).filter(t => t !== '<none>:<none>');
    const tagText = tags.length ? esc(tags[0]) : '<none>';
    const moreCount = tags.length > 1 ? ` <span class="text-muted">+${tags.length - 1}</span>` : '';

    const created = img.Created ? formatDate(new Date(img.Created * 1000)) : '-';

    let usageBadge;
    if (img.in_use) {
      const c = img.containers[0];
      const cName = (c.Names && c.Names[0] || c.Id.substring(0, 12)).replace(/^\//, '');
      const more = img.containers.length > 1 ? ` <span class="text-muted">+${img.containers.length - 1}</span>` : '';
      usageBadge = `<span class="badge badge-running">${I18n.t('images.inUse') || '使用中'}</span> <span style="color:var(--text-secondary);font-size:12px">${esc(cName)}${more}</span>`;
    } else {
      usageBadge = `<span class="badge badge-stopped">${I18n.t('images.unused') || '未使用'}</span>`;
    }

    const removeLabel = I18n.t('images.remove') || '删除';
    const detailLabel = I18n.t('images.detail') || '详情';
    const forceLabel = I18n.t('images.forceRemove') || '强制删除';

    return `
      <tr>
        <td><span class="commit-sha" title="${esc(img.Id)}">${esc(img.shortId || img.Id.substring(7, 19))}</span></td>
        <td><small>${tagText}${moreCount}</small></td>
        <td>${formatBytes(img.Size || 0)}</td>
        <td><small>${esc(created)}</small></td>
        <td>${usageBadge}</td>
        <td class="action-cell">
          <button class="btn btn-sm" onclick="Images.showDetail('${img.Id}')">${detailLabel}</button>
          <button class="btn btn-sm btn-danger" onclick="Images.confirmRemove('${img.Id}', ${img.in_use})">${removeLabel}</button>
        </td>
      </tr>`;
  },

  async confirmRemove(id, inUse) {
    const img = this.data.images.find(i => i.Id === id);
    if (!img) return;

    const tags = (img.RepoTags || []).filter(t => t !== '<none>:<none>');
    const displayName = tags[0] || img.shortId;

    let content;
    let actions;

    if (inUse) {
      const containerList = img.containers.map(c =>
        `· ${esc((c.Names[0] || c.Id).replace(/^\//, ''))} (${esc(c.State)})`
      ).join('<br>');
      content = `
        <div class="rm-info">
          <div class="rm-row"><span class="rm-label">${I18n.t('images.image') || '镜像'}</span><span class="rm-value">${esc(displayName)}</span></div>
          <div class="rm-row"><span class="rm-label">${I18n.t('images.size') || '大小'}</span><span class="rm-value">${formatBytes(img.Size || 0)}</span></div>
        </div>
        <p style="color:#fa0;font-size:13px;margin-bottom:12px" data-i18n="images.inUseWarn">
          ⚠ 此镜像正被以下容器使用，强制删除可能导致容器运行异常。
        </p>
        <div class="log-viewer" style="max-height:140px;margin-bottom:12px">${containerList}</div>
        <p class="rm-warn" data-i18n="images.forceRemoveWarn">强制删除后，正在运行的容器将无法重启。请确认。</p>
      `;
      actions = [
        { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
        {
          label: I18n.t('images.forceRemove') || '强制删除',
          class: 'btn-danger',
          onClick: () => this.removeImage(id, { force: true })
        }
      ];
    } else {
      content = `
        <div class="rm-info">
          <div class="rm-row"><span class="rm-label">${I18n.t('images.image') || '镜像'}</span><span class="rm-value">${esc(displayName)}</span></div>
          <div class="rm-row"><span class="rm-label">${I18n.t('images.size') || '大小'}</span><span class="rm-value">${formatBytes(img.Size || 0)}</span></div>
        </div>
        <p class="rm-warn" data-i18n="images.removeConfirm">确定删除此镜像？此操作不可撤销。</p>
      `;
      actions = [
        { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
        {
          label: I18n.t('images.remove') || '删除',
          class: 'btn-danger',
          onClick: () => this.removeImage(id, { force: false })
        }
      ];
    }

    Modal.show(I18n.t('images.remove') || '删除镜像', content, actions);
    I18n.apply();
  },

  async removeImage(id, options = {}) {
    try {
      Notify.info(I18n.t('images.removing') || '正在删除...');
      await API.removeImage(id, options);
      Notify.success(I18n.t('images.removed') || '镜像已删除');
      await this.loadList();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async confirmPrune() {
    const totals = this.data.totals || {};
    const unused = totals.unusedCount || 0;
    const unusedSize = totals.unusedSize || 0;

    if (unused === 0) {
      Notify.info(I18n.t('images.nothingToPrune') || '没有可清理的未使用镜像');
      return;
    }

    const content = `
      <div class="rm-warn" style="font-size:14px;margin-bottom:12px">
        <strong data-i18n="images.pruneWarnTitle">⚠ 即将清理所有未使用镜像</strong>
      </div>
      <div class="rm-info">
        <div class="rm-row"><span class="rm-label">${I18n.t('images.unusedCount') || '未使用镜像'}</span><span class="rm-value">${unused} 个</span></div>
        <div class="rm-row"><span class="rm-label">${I18n.t('images.unusedSize') || '可释放空间'}</span><span class="rm-value">${formatBytes(unusedSize)}</span></div>
      </div>
      <p style="color:#ccc;font-size:13px;line-height:1.6;margin-bottom:12px" data-i18n="images.pruneWarnBody">
        将删除所有未被任何容器使用的镜像。此操作不可撤销，但不影响正在运行的容器。
      </p>
      <p class="rm-warn" data-i18n="images.pruneFinal">请确认是否继续？</p>
    `;

    Modal.show(I18n.t('images.pruneAll') || '一键删除未使用', content, [
      { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
      {
        label: I18n.t('images.pruneAll') || '一键删除未使用',
        class: 'btn-danger',
        onClick: () => this.doPrune()
      }
    ]);
    I18n.apply();
  },

  async doPrune() {
    try {
      Notify.info(I18n.t('images.pruning') || '正在清理未使用镜像...');
      const result = await API.pruneImages();
      // Our backend now returns { SpaceReclaimed, ImagesDeleted, deleted, output }
      // regardless of whether the call exited 0 or not (it can exit non-zero
      // with "0 deleted" if there's nothing to prune on some Docker versions).
      const reclaimed = (result && (result.SpaceReclaimed || 0)) || 0;
      const deleted = (result && (
        typeof result.deleted === 'number'
          ? result.deleted
          : (Array.isArray(result.ImagesDeleted) ? result.ImagesDeleted.length : 0)
      )) || 0;
      Notify.success(
        (I18n.t('images.pruned') || '已清理 {n} 个未使用镜像，释放 {size}')
          .replace('{n}', deleted)
          .replace('{size}', formatBytes(reclaimed))
      );
      await this.loadList();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async showDetail(id) {
    const img = this.data.images.find(i => i.Id === id);
    if (!img) return;

    let history = [];
    try {
      const h = await API.getImageHistory(id);
      history = (h && h.history) || [];
    } catch { /* ignore */ }

    let inspect = null;
    try {
      inspect = await API.getImage(id);
    } catch { /* ignore */ }

    const tags = (img.RepoTags || []).filter(t => t !== '<none>:<none>');
    const created = img.Created ? formatDate(new Date(img.Created * 1000)) : '-';

    const containerList = img.containers.length
      ? `<table>
          <thead><tr>
            <th>${I18n.t('images.containerName') || '容器'}</th>
            <th>${I18n.t('images.containerState') || '状态'}</th>
            <th>${I18n.t('images.containerStatus') || '详情'}</th>
          </tr></thead>
          <tbody>${img.containers.map(c => `
            <tr>
              <td>${esc((c.Names[0] || c.Id).replace(/^\//, ''))}</td>
              <td><span class="badge badge-${c.State === 'running' ? 'running' : c.State === 'paused' ? 'paused' : 'stopped'}">${esc(c.State)}</span></td>
              <td><small>${esc(c.Status || '')}</small></td>
            </tr>
          `).join('')}</tbody>
        </table>`
      : `<p style="color:var(--text-muted)" data-i18n="images.unused">未使用</p>`;

    const historyTable = history.length
      ? `<table>
          <thead><tr>
            <th>#</th>
            <th>${I18n.t('images.layer') || '层'}</th>
            <th>${I18n.t('images.layerSize') || '大小'}</th>
            <th>${I18n.t('images.createdBy') || '创建指令'}</th>
          </tr></thead>
          <tbody>${history.map((h, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><span class="commit-sha">${esc(h.Id ? h.Id.substring(7, 19) : '-')}</span></td>
              <td>${formatBytes(h.Size || 0)}</td>
              <td><small style="color:var(--text-secondary);word-break:break-all">${esc((h.CreatedBy || '').substring(0, 200))}</small></td>
            </tr>
          `).join('')}</tbody>
        </table>`
      : '';

    const content = `
      <div class="rm-info">
        <div class="rm-row"><span class="rm-label">ID</span><span class="rm-value"><span class="commit-sha">${esc(img.Id)}</span></span></div>
        <div class="rm-row"><span class="rm-label">${I18n.t('images.repoTags') || 'Tags'}</span><span class="rm-value"><small>${tags.length ? tags.map(esc).join('<br>') : '<none>'}</small></span></div>
        <div class="rm-row"><span class="rm-label">${I18n.t('images.size') || '大小'}</span><span class="rm-value">${formatBytes(img.Size || 0)}</span></div>
        <div class="rm-row"><span class="rm-label">${I18n.t('images.created') || '创建时间'}</span><span class="rm-value"><small>${esc(created)}</small></span></div>
      </div>
      <div class="form-group">
        <label data-i18n="images.usageDetail">被以下容器使用</label>
        ${containerList}
      </div>
      ${historyTable ? `<div class="form-group">
        <label data-i18n="images.history">构建历史</label>
        ${historyTable}
      </div>` : ''}
    `;

    Modal.show((tags[0] || img.shortId), content, [
      { label: I18n.t('common.close') || '关闭', class: 'btn-secondary' }
    ]);
    I18n.apply();
  }
};
