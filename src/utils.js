const logger = require('./logger');

function extractIdFromGid(gid) {
  if (!gid) return null;
  const parts = gid.toString().split('/');
  return parts[parts.length - 1];
}

function isProductDiscontinued(productData, variants) {
  if (!variants || !Array.isArray(variants)) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const variant of variants) {
    if (!variant || typeof variant !== 'object') {
      continue;
    }

    if (variant.discontinued_date) {
      if (variant.discontinued_date === '2099-12-31') {
        continue;
      }

      try {
        const discontinuedDate = new Date(variant.discontinued_date);
        if (isNaN(discontinuedDate.getTime())) {
          logger.debug('Invalid discontinued_date format', {
            date: variant.discontinued_date,
            sku: variant.sku
          });
          continue;
        }

        discontinuedDate.setHours(0, 0, 0, 0);

        if (discontinuedDate < today) {
          return true;
        }
      } catch (err) {
        logger.debug('Error parsing discontinued_date', {
          date: variant.discontinued_date,
          sku: variant.sku,
          error: err.message
        });
      }
    }
  }

  return false;
}

module.exports = {
  extractIdFromGid,
  isProductDiscontinued
};
