const { shopifyRest, shopifyGraphql, sleep } = require('./shopifyClient');
const logger = require('./logger');

const SYNC_TAG = 'midocean-sync';
const PAGE_SIZE = 250;
const DELAY_MS = 300;

function extractIdFromGid(gid) {
  if (!gid) return null;
  const parts = gid.toString().split('/');
  return parts[parts.length - 1];
}

async function run() {
  let cursor = null;
  let total = 0;
  let updated = 0;
  let skippedNoMetafield = 0;
  let skippedAlreadyTagged = 0;
  const activeWithoutMasterCode = [];

  try {
    do {
      const query = `
        query getActiveProducts($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, query: $query) {
            edges {
              node {
                id
                title
                handle
                tags
                metafield(namespace: "midocean", key: "master_code") {
                  value
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;
      const variables = {
        first: PAGE_SIZE,
        after: cursor,
        query: 'status:active'
      };
      const data = await shopifyGraphql(query, variables);
      if (!data || !data.products) break;

      const edges = data.products.edges || [];
      for (const edge of edges) {
        const node = edge.node;
        total++;
        if (!node.metafield?.value) {
          skippedNoMetafield++;
          activeWithoutMasterCode.push({
            id: extractIdFromGid(node.id),
            title: node.title,
            handle: node.handle
          });
          continue;
        }
        const tags = (node.tags || []).filter(Boolean);
        if (tags.includes(SYNC_TAG)) {
          skippedAlreadyTagged++;
          continue;
        }
        const id = extractIdFromGid(node.id);
        if (!id) continue;
        try {
          const newTags = [...tags, SYNC_TAG].join(', ');
          await shopifyRest('PUT', `/products/${id}.json`, { product: { id, tags: newTags } });
          updated++;
          logger.info('Tag added', { productId: id, master_code: node.metafield.value });
        } catch (err) {
          logger.error('Failed to add tag', { productId: id, error: err.message });
        }
        await sleep(DELAY_MS);
      }

      const pageInfo = data.products.pageInfo || {};
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
      await sleep(DELAY_MS);
    } while (true);

    logger.info('Backfill complete', {
      total,
      updated,
      skippedNoMetafield,
      skippedAlreadyTagged,
      skippedTotal: skippedNoMetafield + skippedAlreadyTagged
    });
    if (activeWithoutMasterCode.length > 0) {
      logger.info('Active products without midocean.master_code metafield', {
        count: activeWithoutMasterCode.length,
        products: activeWithoutMasterCode
      });
    }
  } catch (err) {
    logger.error('Backfill failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

run();
