const http = require('node:http');
const createError = require('http-errors');

const TITLES = {
  400: 'Bad request',
  401: 'Sign-in required',
  403: 'Access denied',
  404: 'Page not found',
  409: 'Changed by someone else',
  413: 'File too large',
  429: 'Too many requests',
  500: 'Something went wrong',
};

function notFound(req, res, next) {
  next(createError(404, 'The page you are looking for does not exist.'));
}

function describeError(err, config) {
  if (err.name === 'CastError') {
    return { status: 404, message: 'The page you are looking for does not exist.' };
  }
  // A record deleted, or changed, by someone else while this request was saving it.
  if (err.name === 'DocumentNotFoundError') {
    return { status: 404, message: 'This item no longer exists. It may have just been deleted.' };
  }
  if (err.name === 'VersionError') {
    return {
      status: 409,
      message: 'This item was changed by someone else. Reload the page and try again.',
    };
  }
  if (err.code === 'EBADCSRFTOKEN') {
    return { status: 403, message: 'Your session expired. Reload the page and try again.' };
  }
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = Math.round((config.uploads.maxBytes / (1024 * 1024)) * 10) / 10;
      return { status: 413, message: `The file is too large. The maximum size is ${maxMb} MB.` };
    }
    return { status: 400, message: 'The upload could not be processed.' };
  }
  const status = err.status ?? err.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    const message = status < 500 && err.expose !== false ? err.message : 'Something went wrong.';
    return { status, message };
  }
  return { status: 500, message: 'Something went wrong.' };
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const config = req.app.get('config');
  const { status, message } = describeError(err, config);
  if (status >= 500) console.error(err);

  res.status(status);
  if (req.accepts(['html', 'json']) === 'json') {
    return res.json({ error: { status, message } });
  }

  const locals = {
    title: TITLES[status] ?? http.STATUS_CODES[status] ?? 'Error',
    status,
    message,
    stack: config.env === 'development' ? err.stack : undefined,
  };
  res.render('error', locals, (renderError, html) => {
    if (renderError) {
      console.error('Unable to render the error page:', renderError);
      return res.type('text/plain').send(`${status} ${locals.title}\n\n${message}`);
    }
    res.send(html);
  });
}

module.exports = { notFound, errorHandler };
