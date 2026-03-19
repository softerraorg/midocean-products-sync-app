const { shopifyGraphql } = require('./shopifyClient');
const logger = require('./logger');
const { extractIdFromGid } = require('./utils');
const { MAX_PRODUCT_IMAGES, GRAPHQL_VARIANTS_LIMIT } = require('./config');

async function findProductBySku(sku) {
  if (!sku || typeof sku !== 'string') {
    logger.warn('Invalid SKU provided to findProductBySku', { sku });
    return null;
  }

  try {
    const query = `
      query getProductBySKU($query: String!) {
        products(first: 10, query: $query) {
          edges {
            node {
              id
              title
              status
              variants(first: 50) {
                edges {
                  node {
                    id
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphql(query, {
      query: `sku:${sku}`
    });

    if (!data || !data.products) {
      logger.debug('No products data returned from GraphQL query', { sku });
      return null;
    }

    const products = data.products.edges || [];
    if (products.length > 0) {
      return products[0].node;
    }
    return null;
  } catch (err) {
    logger.error('Error finding product by SKU', {
      sku,
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

async function getProductWithAllVariants(productId) {
  if (!productId) {
    logger.warn('Cannot get product: missing productId');
    return null;
  }

  try {
    const id = productId.includes('/') ? extractIdFromGid(productId) : productId;
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          status
          images(first: ${MAX_PRODUCT_IMAGES}) {
            edges {
              node {
                id
                url
              }
            }
          }
          variants(first: ${GRAPHQL_VARIANTS_LIMIT}) {
            edges {
              node {
                id
                sku
                price
                barcode
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphql(query, { id: `gid://shopify/Product/${id}` });

    if (!data || !data.product) {
      logger.debug('Product not found', { productId: id });
      return null;
    }

    return data.product;
  } catch (err) {
    logger.error('Error getting product with variants', {
      productId,
      error: err.message,
      stack: err.stack
    });
    return null;
  }
}

module.exports = {
  findProductBySku,
  getProductWithAllVariants
};
