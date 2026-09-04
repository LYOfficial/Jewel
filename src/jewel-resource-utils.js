function normalizeDockerId(value) {
  return String(value || '').replace(/^sha256:/, '');
}

function sameDockerId(left, right) {
  const a = normalizeDockerId(left);
  const b = normalizeDockerId(right);
  return Boolean(a && b && a === b);
}

function hasContainerName(container, name) {
  return (container.Names || []).some(candidate =>
    String(candidate || '').replace(/^\//, '') === name
  );
}

function findJewelContainer(containers, configuredName = 'jewel') {
  const all = Array.isArray(containers) ? containers : [];

  // Prefer the explicitly configured name during a self-update, when a
  // temporary rollback container can carry the same Jewel label.
  return all.find(container => hasContainerName(container, configuredName)) ||
    all.find(container => container.Labels && container.Labels['io.jewel.managed'] === 'true') ||
    null;
}

function summarizeJewelStorage(container = {}, info = {}, diskUsage = {}) {
  const imageId = info.Image || container.ImageID || '';
  const images = Array.isArray(diskUsage.Images) ? diskUsage.Images : [];
  const image = images.find(candidate => sameDockerId(candidate.Id, imageId));
  const writableLayerBytes = Math.max(0, Number(container.SizeRw) || 0);

  // Docker's disk-usage API provides a portable image size. If it is not
  // available on an older Engine, SizeRootFs still gives a useful fallback
  // without double-counting the writable layer.
  const imageBytes = Math.max(
    0,
    Number(image && image.Size) ||
      ((Number(container.SizeRootFs) || 0) - writableLayerBytes)
  );

  const dataMount = (info.Mounts || []).find(mount => mount.Destination === '/data');
  const volumes = Array.isArray(diskUsage.Volumes) ? diskUsage.Volumes : [];
  const dataVolume = dataMount && dataMount.Type === 'volume'
    ? volumes.find(volume => volume.Name === (dataMount.Name || dataMount.Source))
    : null;
  const hasMeasuredData = Boolean(dataVolume && dataVolume.UsageData && Number.isFinite(Number(dataVolume.UsageData.Size)));
  const dataBytes = hasMeasuredData ? Math.max(0, Number(dataVolume.UsageData.Size)) : null;

  return {
    total_bytes: imageBytes + writableLayerBytes + (dataBytes || 0),
    image_bytes: imageBytes,
    writable_layer_bytes: writableLayerBytes,
    data_bytes: dataBytes,
    data_included: hasMeasuredData,
    data_mount_type: dataMount ? dataMount.Type : null
  };
}

module.exports = {
  findJewelContainer,
  sameDockerId,
  summarizeJewelStorage
};
