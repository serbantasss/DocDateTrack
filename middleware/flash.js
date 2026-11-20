/**
 * Session-backed flash messages with the connect-flash API:
 *   req.flash(type, message) queues a message (or an array of messages) and returns the count,
 *   req.flash(type) returns and clears the messages of one type,
 *   req.flash() returns and clears all messages.
 */
function flashMessages(type, message) {
  if (!this.session) throw new Error('req.flash() requires sessions.');
  const messages = (this.session.flash ??= {});
  if (type && message !== undefined) {
    const queue = (messages[type] ??= []);
    queue.push(...(Array.isArray(message) ? message : [message]));
    return queue.length;
  }
  if (type) {
    const queue = messages[type] ?? [];
    delete messages[type];
    return queue;
  }
  this.session.flash = {};
  return messages;
}

function flash() {
  return (req, res, next) => {
    req.flash = flashMessages;
    next();
  };
}

module.exports = { flash };
