import { env } from '../config/env.js';
import { fetchWithRetry } from '../lib/http.js';
export const fetchCategoryGrid = async (size = 300) => {
    const variables = {
        id: env.SONY_CATEGORY_ID,
        locale: env.SONY_LOCALE,
        pageArgs: { size, offset: 0 },
        sortBy: { name: 'productReleaseDate', isAscending: false },
        facetOptions: [],
    };
    const extensions = {
        persistedQuery: { version: 1, sha256Hash: env.SONY_CATEGORY_GRID_HASH },
    };
    const query = new URLSearchParams({
        variables: JSON.stringify(variables),
        extensions: JSON.stringify(extensions),
    }).toString();
    const response = await fetchWithRetry(`${env.SONY_GRAPHQL_URL}?${query}`, {
        method: 'GET',
        headers: {
            'x-apollo-operation-name': env.SONY_OPERATION_NAME,
        },
    }, env.SONY_TIMEOUT_MS, env.SONY_RETRY_COUNT);
    const json = (await response.json());
    return json.data?.categoryGridRetrieve?.products ?? [];
};
