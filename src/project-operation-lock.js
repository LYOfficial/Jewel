// Serialize state-changing work for an individual project. Git has its own
// repository lock, but a project update also includes a Compose deployment;
// this lock keeps scheduled and user-triggered operations from overlapping.
const projectLocks = new Map();

function withProjectOperationLock(projectId, fn) {
  const key = String(projectId);
  const previous = projectLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const queue = previous.then(() => next);
  projectLocks.set(key, queue);

  return previous.then(fn).finally(() => {
    release();
    if (projectLocks.get(key) === queue) projectLocks.delete(key);
  });
}

module.exports = { withProjectOperationLock };
