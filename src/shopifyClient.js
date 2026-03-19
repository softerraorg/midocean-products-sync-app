const axios = require('axios');
const { storeDomain, apiVersion, accessToken, API_RATE_LIMIT_THRESHOLD } = require('./config');
const logger = require('./logger');

const BASE_URL = `https://${storeDomain}/admin/api/${apiVersion}`;

// Timeout for Shopify API requests (ms). Product creation with many variants can exceed 30s.
const SHOPIFY_REQUEST_TIMEOUT_MS = 90000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function shopifyRest(method, path, data = null, retries = 3) {
  const url = `${BASE_URL}${path}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios({
        method,
        url,
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        data,
        timeout: SHOPIFY_REQUEST_TIMEOUT_MS
      });

      const callLimit = response.headers['x-shopify-shop-api-call-limit'];
      if (callLimit) {
        const [used, bucket] = callLimit.split('/').map(n => parseInt(n, 10));
        if (bucket && used >= bucket - API_RATE_LIMIT_THRESHOLD) {
          logger.debug('Approaching Shopify API rate limit, waiting', { used, bucket });
          await sleep(1000);
        }
      }

      return response.data;
    } catch (err) {
      const status = err.response?.status;
      const isLastAttempt = attempt === retries - 1;
      const errorDetails = {
        method,
        path,
        attempt: attempt + 1,
        maxRetries: retries,
        status,
        statusText: err.response?.statusText,
        message: err.message,
        code: err.code
      };

      // Handle rate limiting
      if (status === 429) {
        const retryAfter = err.response.headers['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 2000;
        logger.warn('Shopify API rate limited, waiting before retry', { waitMs, ...errorDetails });
        await sleep(waitMs);
        continue;
      }

      // Handle timeout errors
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        logger.warn('Shopify API request timeout', errorDetails);
        if (!isLastAttempt) {
          await sleep((attempt + 1) * 2000);
          continue;
        }
      }

      // Handle network errors
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET') {
        logger.warn('Shopify API network error', errorDetails);
        if (!isLastAttempt) {
          await sleep((attempt + 1) * 2000);
          continue;
        }
      }

      // Handle 4xx errors (client errors - don't retry)
      if (status >= 400 && status < 500 && status !== 429) {
        logger.error('Shopify API client error (not retrying)', {
          ...errorDetails,
          responseData: err.response?.data
        });
        throw err;
      }

      // Handle 5xx errors (server errors - retry)
      if (status >= 500) {
        logger.warn('Shopify API server error, retrying', errorDetails);
        if (!isLastAttempt) {
          await sleep((attempt + 1) * 2000);
          continue;
        }
      }

      if (isLastAttempt) {
        logger.error('Shopify REST API request failed after all retries', {
          ...errorDetails,
          responseData: err.response?.data,
          stack: err.stack
        });
        throw err;
      }

      logger.warn('Shopify REST API error, retrying', errorDetails);
      await sleep((attempt + 1) * 2000);
    }
  }

  throw new Error('Max retries exceeded for Shopify REST request');
}

async function shopifyGraphql(query, variables = {}, retries = 3) {
  const url = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios({
        method: 'POST',
        url,
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        data: { query, variables },
        timeout: SHOPIFY_REQUEST_TIMEOUT_MS
      });

      const callLimit = response.headers['x-shopify-shop-api-call-limit'];
      if (callLimit) {
        const [used, bucket] = callLimit.split('/').map(n => parseInt(n, 10));
        if (bucket && used >= bucket - API_RATE_LIMIT_THRESHOLD) {
          logger.debug('Approaching Shopify GraphQL API rate limit, waiting', { used, bucket });
          await sleep(1000);
        }
      }

      // Check for GraphQL errors
      if (response.data.errors) {
        const graphqlErrors = response.data.errors;
        logger.error('Shopify GraphQL errors', {
          errors: graphqlErrors,
          query: query.substring(0, 100) + '...',
          variables
        });
        throw new Error(`GraphQL errors: ${JSON.stringify(graphqlErrors)}`);
      }

      // Validate response structure
      if (!response.data || !response.data.data) {
        logger.warn('Unexpected GraphQL response structure', { response: response.data });
      }

      return response.data.data;
    } catch (err) {
      const status = err.response?.status;
      const isLastAttempt = attempt === retries - 1;
      const errorDetails = {
        attempt: attempt + 1,
        maxRetries: retries,
        status,
        statusText: err.response?.statusText,
        message: err.message,
        code: err.code,
        query: query.substring(0, 100) + '...'
      };

      // Handle rate limiting
      if (status === 429) {
        const retryAfter = err.response.headers['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 2000;
        logger.warn('Shopify GraphQL API rate limited, waiting before retry', { waitMs, ...errorDetails });
        await sleep(waitMs);
        continue;
      }

      // Handle timeout errors
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        logger.warn('Shopify GraphQL API request timeout', errorDetails);
        if (!isLastAttempt) {
          await sleep((attempt + 1) * 2000);
          continue;
        }
      }

      // Handle network errors
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET') {
        logger.warn('Shopify GraphQL API network error', errorDetails);
        if (!isLastAttempt) {
          await sleep((attempt + 1) * 2000);
          continue;
        }
      }

      // Handle 4xx errors (client errors - don't retry)
      if (status >= 400 && status < 500 && status !== 429) {
        logger.error('Shopify GraphQL API client error (not retrying)', {
          ...errorDetails,
          responseData: err.response?.data
        });
        throw err;
      }

      // Handle 5xx errors (server errors - retry)
      if (status >= 500) {
        logger.warn('Shopify GraphQL API server error, retrying', errorDetails);
        if (!isLastAttempt) {
          await sleep((attempt + 1) * 2000);
          continue;
        }
      }

      if (isLastAttempt) {
        logger.error('Shopify GraphQL API request failed after all retries', {
          ...errorDetails,
          responseData: err.response?.data,
          stack: err.stack
        });
        throw err;
      }

      logger.warn('Shopify GraphQL API error, retrying', errorDetails);
      await sleep((attempt + 1) * 2000);
    }
  }

  throw new Error('Max retries exceeded for Shopify GraphQL request');
}

module.exports = {
  shopifyRest,
  shopifyGraphql,
  sleep
};
