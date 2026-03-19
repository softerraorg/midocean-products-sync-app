const logger = require('./logger');

function buildVariantData(variant, priceMap = null, productData = null) {
  if (!variant || typeof variant !== 'object') {
    return null;
  }

  try {
    let price = '0.00';
    if (priceMap && variant.sku) {
      const mappedPrice = priceMap.get(variant.sku);
      if (mappedPrice) {
        price = mappedPrice;
      } else if (variant.price) {
        price = variant.price.toString();
      }
    } else if (variant.price) {
      price = variant.price.toString();
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      logger.warn('Invalid price value, using 0.00', { sku: variant.sku, price });
      price = '0.00';
    }

    const variantData = {
      sku: variant.sku || '',
      price: price,
      inventory_management: 'shopify',
      inventory_policy: 'deny'
    };

    if (productData && productData.gross_weight) {
      try {
        const grossWeightValue = parseFloat(productData.gross_weight);
        if (!isNaN(grossWeightValue) && grossWeightValue >= 0) {
          variantData.weight = grossWeightValue.toString();
          if (productData.gross_weight_unit) {
            variantData.weight_unit = productData.gross_weight_unit.toLowerCase();
          } else {
            variantData.weight_unit = 'kg';
          }
        }
      } catch (err) {
        logger.debug('Failed to parse gross_weight for variant', {
          sku: variant.sku,
          gross_weight: productData.gross_weight,
          error: err.message
        });
      }
    }

    if (variant.gtin && typeof variant.gtin === 'string' && variant.gtin.trim()) {
      variantData.barcode = variant.gtin.trim();
    }

    if (productData && productData.country_of_origin && typeof productData.country_of_origin === 'string' && productData.country_of_origin.trim()) {
      variantData.country_code_of_origin = productData.country_of_origin.trim().toUpperCase();
    }

    if (productData && productData.commodity_code && typeof productData.commodity_code === 'string' && productData.commodity_code.trim()) {
      const hsCode = productData.commodity_code.trim().replace(/\s+/g, '');
      variantData.harmonized_system_code = hsCode;
    }

    const color = variant.color_description || variant.color_group || variant.pms_color;
    if (color && typeof color === 'string' && color.trim()) {
      variantData.option1 = color.trim();
    }

    return variantData;
  } catch (err) {
    logger.error('Error building variant data', {
      sku: variant?.sku,
      error: err.message
    });
    return null;
  }
}

module.exports = {
  buildVariantData
};
