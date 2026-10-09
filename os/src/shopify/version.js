// The one place the Shopify Admin API version is pinned.
//
// 2026-07 is the newest version Shopify lists as stable (supported until at
// least 1 July 2027); 2026-10 was released on 1 October 2026 but its
// release table still said "release candidate" when this was written.
// Every connection test asks the store for publicApiVersions and runs an
// introspection check of every field this integration uses, so a version
// that drops or renames a field fails before anything is written.
//
// Upgrade once a quarter: change the constant, run "Test connection" on a
// development store (or `npm run shopify:schema` with a test token) and
// read the release notes for products, collections, pages, metaobjects,
// menus and publications.
export const SHOPIFY_API_VERSION = "2026-07";
