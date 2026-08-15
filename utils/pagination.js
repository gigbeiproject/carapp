/**
 * Shared server-side pagination helpers. One place to parse/validate
 * ?page=&limit= query params and build the response's `pagination` block,
 * so every list endpoint follows the same contract instead of each
 * reimplementing its own (or, as before, not paginating at all).
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse page/limit from req.query into safe values for SQL LIMIT/OFFSET.
 * Non-numeric, missing, negative, or zero values fall back to sane
 * defaults; limit is capped at MAX_LIMIT so a client can't request the
 * whole table in one page.
 */
function parsePagination(query, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Build the standard pagination metadata object for a response, given the
 * page/limit that were used and the total row count from a COUNT query.
 * A page requested beyond the last page simply yields hasNextPage: false
 * and an empty `data` array (from the LIMIT/OFFSET query itself) rather
 * than an error.
 */
function buildPaginationMeta(page, limit, total) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

module.exports = { parsePagination, buildPaginationMeta };
