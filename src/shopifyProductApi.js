const { shopifyRest } = require('./shopifyClient');
const logger = require('./logger');
const { extractIdFromGid } = require('./utils');
const { VARIANT_RETRY_DELAY_MS } = require('./config');

async function getProductImages(productId) {
  if (!productId) {
    logger.warn('Cannot get product images: missing productId');
    return [];
  }

  try {
    const id = (typeof productId === 'string' && productId.includes('/')) ? extractIdFromGid(productId) : productId.toString();
    const response = await shopifyRest('GET', `/products/${id}.json`);

    if (response && response.product && response.product.images && Array.isArray(response.product.images)) {
      return response.product.images;
    }

    return [];
  } catch (err) {
    logger.error('Error getting product images', {
      productId,
      error: err.message
    });
    return [];
  }
}

async function addImageToProduct(productId, imageUrl) {
  if (!productId || !imageUrl) {
    logger.warn('Cannot add image: missing productId or imageUrl', { productId, imageUrl });
    return null;
  }

  try {
    const id = (typeof productId === 'string' && productId.includes('/')) ? extractIdFromGid(productId) : String(productId);
    const response = await shopifyRest('POST', `/products/${id}/images.json`, {
      image: {
        src: imageUrl
      }
    });

    if (response && response.image) {
      logger.debug('Image added to product', { productId: id, imageId: response.image.id });
      return response.image;
    }

    return null;
  } catch (err) {
    logger.warn('Failed to add image to product', {
      productId,
      imageUrl,
      error: err.message,
      responseData: err.response?.data
    });
    return null;
  }
}

async function updateVariantImage(variantId, imageId) {
  if (!variantId) {
    logger.warn('Cannot update variant image: missing variantId');
    return false;
  }

  if (!imageId) {
    logger.debug('No imageId provided, skipping variant image update', { variantId });
    return false;
  }

  try {
    const id = (typeof variantId === 'string' && variantId.includes('/')) ? extractIdFromGid(variantId) : variantId;
    const imgId = (typeof imageId === 'string' && imageId.includes('/')) ? extractIdFromGid(imageId) : imageId.toString();

    if (!id) {
      logger.warn('Cannot update variant image: invalid variant ID format', { variantId });
      return false;
    }

    if (!imgId) {
      logger.warn('Cannot update variant image: invalid image ID format', { imageId });
      return false;
    }

    await shopifyRest('PUT', `/variants/${id}.json`, {
      variant: {
        id: id,
        image_id: imgId
      }
    });

    logger.debug('Variant image updated successfully', { variantId: id, imageId: imgId });
    return true;
  } catch (err) {
    logger.warn('Failed to update variant image', {
      variantId,
      imageId,
      error: err.message,
      responseData: err.response?.data
    });
    return false;
  }
}

async function addVariantToProduct(productId, variantData) {
  if (!productId || !variantData) {
    logger.warn('Cannot add variant: missing productId or variantData', { productId, variantData });
    return null;
  }

  try {
    const id = (typeof productId === 'string' && productId.includes('/')) ? extractIdFromGid(productId) : String(productId);
    const response = await shopifyRest('POST', `/products/${id}/variants.json`, {
      variant: variantData
    });

    if (response && response.variant) {
      return response.variant;
    }

    logger.warn('Invalid response when adding variant', { productId: id, response });
    return null;
  } catch (err) {
    logger.error('Failed to add variant to product', {
      productId,
      sku: variantData.sku,
      error: err.message,
      responseData: err.response?.data,
      stack: err.stack
    });
    return null;
  }
}

async function removeVariant(variantId) {
  if (!variantId) {
    logger.warn('Cannot remove variant: missing variantId');
    return false;
  }

  try {
    const id = (typeof variantId === 'string' && variantId.includes('/')) ? extractIdFromGid(variantId) : String(variantId);
    await shopifyRest('DELETE', `/variants/${id}.json`);
    logger.info('Variant removed successfully', { variantId: id });
    return true;
  } catch (err) {
    logger.error('Failed to remove variant', {
      variantId,
      error: err.message,
      responseData: err.response?.data,
      stack: err.stack
    });
    return false;
  }
}

async function updateVariantPrice(variantId, price) {
  if (!variantId) {
    logger.warn('Cannot update variant price: missing variantId');
    return false;
  }

  if (!price || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
    logger.warn('Cannot update variant price: invalid price value', { variantId, price });
    return false;
  }

  try {
    const id = (typeof variantId === 'string' && variantId.includes('/')) ? extractIdFromGid(variantId) : String(variantId);

    if (!id) {
      logger.warn('Cannot update variant price: invalid variant ID format', { variantId });
      return false;
    }

    await shopifyRest('PUT', `/variants/${id}.json`, {
      variant: {
        id: id,
        price: price.toString()
      }
    });

    logger.debug('Variant price updated successfully', { variantId: id, price });
    return true;
  } catch (err) {
    logger.warn('Failed to update variant price', {
      variantId,
      price,
      error: err.message,
      responseData: err.response?.data
    });
    return false;
  }
}

async function updateVariantCustomsInfo(variantId, productData, inventoryItemId = null) {
  if (!variantId || !productData) {
    return false;
  }

  try {
    const id = variantId.toString().includes('/') ? extractIdFromGid(variantId.toString()) : variantId.toString();

    if (!id) {
      logger.warn('Cannot update variant customs info: invalid variant ID format', { variantId });
      return false;
    }

    let inventoryItemIdToUse = inventoryItemId;

    if (!inventoryItemIdToUse) {
      try {
        const variantResponse = await shopifyRest('GET', `/variants/${id}.json`);
        if (!variantResponse || !variantResponse.variant || !variantResponse.variant.inventory_item_id) {
          logger.warn('Cannot update variant customs info: inventory_item_id not found', {
            variantId: id,
            variantResponse: variantResponse
          });
          return false;
        }
        inventoryItemIdToUse = variantResponse.variant.inventory_item_id;
      } catch (err) {
        if (err.response?.status === 400 || err.response?.status === 404) {
          logger.debug('Variant not immediately available, waiting before retry', { variantId: id });
          await new Promise(resolve => setTimeout(resolve, VARIANT_RETRY_DELAY_MS));
          try {
            const variantResponse = await shopifyRest('GET', `/variants/${id}.json`);
            if (variantResponse && variantResponse.variant && variantResponse.variant.inventory_item_id) {
              inventoryItemIdToUse = variantResponse.variant.inventory_item_id;
            } else {
              logger.warn('Cannot update variant customs info: inventory_item_id not found after retry', { variantId: id });
              return false;
            }
          } catch (retryErr) {
            logger.warn('Failed to get variant details after retry', {
              variantId: id,
              error: retryErr.message,
              status: retryErr.response?.status
            });
            return false;
          }
        } else {
          throw err;
        }
      }
    }

    const inventoryItemData = {
      id: inventoryItemIdToUse
    };

    if (productData.country_of_origin && typeof productData.country_of_origin === 'string' && productData.country_of_origin.trim()) {
      inventoryItemData.country_code_of_origin = productData.country_of_origin.trim().toUpperCase();
    }

    if (productData.commodity_code && typeof productData.commodity_code === 'string' && productData.commodity_code.trim()) {
      const hsCode = productData.commodity_code.trim().replace(/\s+/g, '');
      const hsCodeNum = parseInt(hsCode, 10);
      inventoryItemData.harmonized_system_code = !isNaN(hsCodeNum) ? hsCodeNum : hsCode;
    }

    if (Object.keys(inventoryItemData).length > 1) {
      await shopifyRest('PUT', `/inventory_items/${inventoryItemIdToUse}.json`, {
        inventory_item: inventoryItemData
      });
      return true;
    } else {
      logger.debug('No customs info to update', { variantId: id, inventoryItemId: inventoryItemId });
      return false;
    }
  } catch (err) {
    logger.error('Failed to update variant customs info', {
      variantId,
      error: err.message,
      status: err.response?.status,
      statusText: err.response?.statusText,
      responseData: err.response?.data,
      stack: err.stack
    });
    return false;
  }
}

module.exports = {
  getProductImages,
  addImageToProduct,
  updateVariantImage,
  addVariantToProduct,
  removeVariant,
  updateVariantPrice,
  updateVariantCustomsInfo
};
