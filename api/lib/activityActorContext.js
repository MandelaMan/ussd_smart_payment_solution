const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

/**
 * Bind the authenticated admin as the activity actor for the rest of the request.
 * @param {{ id?: number|string, name?: string } | null} actor
 * @param {() => any} fn
 */
function runWithActivityActor(actor, fn) {
  if (!actor?.id && !actor?.name) {
    return fn();
  }
  return storage.run(
    {
      id: actor.id != null ? Number(actor.id) : null,
      name: actor.name ? String(actor.name).trim() : null,
    },
    fn
  );
}

function getActivityActor() {
  return storage.getStore() || null;
}

/** Normalize req.user (or similar) into an activity actor payload. */
function actorFromUser(user) {
  if (!user) return null;
  const name = user.name ? String(user.name).trim() : "";
  if (!user.id && !name) return null;
  return {
    id: user.id != null ? Number(user.id) : null,
    name: name || null,
  };
}

module.exports = {
  runWithActivityActor,
  getActivityActor,
  actorFromUser,
};
