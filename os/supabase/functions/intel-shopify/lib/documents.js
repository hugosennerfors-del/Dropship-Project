// Every Admin GraphQL operation this integration sends. Field and argument
// names follow the Admin GraphQL reference for the pinned version; they
// are not trusted blindly: schema.js checks each one against the store's
// own schema (introspection) before a job writes anything.

export const Q = {
  shop: `query PlanvyShop { shop { name myshopifyDomain currencyCode primaryDomain { url host } plan { publicDisplayName partnerDevelopment shopifyPlus } } }`,
  scopes: `query PlanvyScopes { currentAppInstallation { accessScopes { handle } } }`,
  versions: `query PlanvyVersions { publicApiVersions { handle displayName supported } }`,
  productByHandle: `query PlanvyProductByHandle($handle: String!) { productByIdentifier(identifier: { handle: $handle }) { id handle status title } }`,
  collectionByHandle: `query PlanvyCollectionByHandle($handle: String!) { collectionByIdentifier(identifier: { handle: $handle }) { id handle title } }`,
  pageByHandle: `query PlanvyPageByHandle($query: String!) { pages(first: 1, query: $query) { nodes { id handle isPublished title } } }`,
  metaobjectDefinition: `query PlanvyMetaobjectDefinition($type: String!) { metaobjectDefinitionByType(type: $type) { id type } }`,
  publications: `query PlanvyPublications($after: String) { publications(first: 50, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } }`,
  menus: `query PlanvyMenus($after: String) { menus(first: 25, after: $after) { nodes { id handle title items { id title type resourceId url tags items { id title type resourceId url tags items { id title type resourceId url tags } } } } pageInfo { hasNextPage endCursor } } }`,
};

const ERR = "userErrors { field message }";
export const M = {
  productSet: `mutation PlanvyProductSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!, $synchronous: Boolean) {
    productSet(identifier: $identifier, input: $input, synchronous: $synchronous) { product { id handle status title } ${ERR} } }`,
  productStatus: `mutation PlanvyProductStatus($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id status } ${ERR} } }`,
  productDelete: `mutation PlanvyProductDelete($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId ${ERR} } }`,
  collectionCreate: `mutation PlanvyCollectionCreate($input: CollectionInput!) { collectionCreate(input: $input) { collection { id handle title } ${ERR} } }`,
  collectionDelete: `mutation PlanvyCollectionDelete($input: CollectionDeleteInput!) { collectionDelete(input: $input) { deletedCollectionId ${ERR} } }`,
  metaobjectDefinitionCreate: `mutation PlanvyMetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } ${ERR} } }`,
  metaobjectUpsert: `mutation PlanvyMetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id handle } ${ERR} } }`,
  metaobjectDelete: `mutation PlanvyMetaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { deletedId ${ERR} } }`,
  pageCreate: `mutation PlanvyPageCreate($page: PageCreateInput!) { pageCreate(page: $page) { page { id handle isPublished } ${ERR} } }`,
  pageUpdate: `mutation PlanvyPageUpdate($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id isPublished } ${ERR} } }`,
  pageDelete: `mutation PlanvyPageDelete($id: ID!) { pageDelete(id: $id) { deletedPageId ${ERR} } }`,
  menuUpdate: `mutation PlanvyMenuUpdate($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id } ${ERR} } }`,
  publish: `mutation PlanvyPublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { ${ERR} } }`,
  unpublish: `mutation PlanvyUnpublish($id: ID!, $input: [PublicationInput!]!) { publishableUnpublish(id: $id, input: $input) { ${ERR} } }`,
};

// What each operation needs from the schema, as paths:
//   "Query.shop"                          a root field
//   "Mutation.productSet(identifier)"     an argument
//   "ProductSetInput.handle"              an input field
// schema.js resolves these against the store's introspection result.
export const NEEDS = {
  base: ["Query.shop", "Query.currentAppInstallation", "Query.publicApiVersions", "ShopPlan.publicDisplayName", "ShopPlan.partnerDevelopment"],
  product: [
    "Query.productByIdentifier(identifier)", "ProductIdentifierInput.handle",
    "Mutation.productSet(identifier)", "Mutation.productSet(input)", "Mutation.productSet(synchronous)", "ProductSetIdentifiers.id",
    "ProductSetInput.title", "ProductSetInput.handle", "ProductSetInput.descriptionHtml", "ProductSetInput.productType", "ProductSetInput.vendor",
    "ProductSetInput.tags", "ProductSetInput.status", "ProductSetInput.seo", "ProductSetInput.productOptions", "ProductSetInput.variants", "ProductSetInput.metafields",
    "OptionSetInput.name", "OptionSetInput.position", "OptionSetInput.values", "OptionValueSetInput.name",
    "ProductVariantSetInput.optionValues", "ProductVariantSetInput.price", "ProductVariantSetInput.compareAtPrice", "ProductVariantSetInput.inventoryItem",
    "VariantOptionValueInput.optionName", "VariantOptionValueInput.name",
    "InventoryItemInput.sku", "InventoryItemInput.tracked", "InventoryItemInput.measurement",
    "SEOInput.title", "SEOInput.description",
  ],
  productImages: ["ProductSetInput.files", "FileSetInput.originalSource", "FileSetInput.alt", "FileSetInput.contentType"],
  collection: ["Query.collectionByIdentifier(identifier)", "CollectionIdentifierInput.handle", "Mutation.collectionCreate(input)", "CollectionInput.title", "CollectionInput.handle",
    "CollectionInput.descriptionHtml", "CollectionInput.ruleSet", "CollectionInput.seo", "CollectionRuleSetInput.rules", "CollectionRuleSetInput.appliedDisjunctively",
    "CollectionRuleInput.column", "CollectionRuleInput.relation", "CollectionRuleInput.condition"],
  metaobject: ["Query.metaobjectDefinitionByType(type)", "Mutation.metaobjectDefinitionCreate(definition)", "MetaobjectDefinitionCreateInput.type",
    "MetaobjectDefinitionCreateInput.name", "MetaobjectDefinitionCreateInput.fieldDefinitions", "MetaobjectDefinitionCreateInput.access",
    "MetaobjectFieldDefinitionCreateInput.key", "MetaobjectFieldDefinitionCreateInput.name", "MetaobjectFieldDefinitionCreateInput.type",
    "MetaobjectAccessInput.storefront", "Mutation.metaobjectUpsert(handle)", "Mutation.metaobjectUpsert(metaobject)", "MetaobjectHandleInput.type",
    "MetaobjectHandleInput.handle", "MetaobjectUpsertInput.fields", "MetaobjectFieldInput.key", "MetaobjectFieldInput.value"],
  page: ["Query.pages(query)", "Mutation.pageCreate(page)", "PageCreateInput.title", "PageCreateInput.handle", "PageCreateInput.body", "PageCreateInput.isPublished",
    "Mutation.pageUpdate(id)", "Mutation.pageUpdate(page)", "PageUpdateInput.title", "PageUpdateInput.body", "PageUpdateInput.isPublished"],
  menu: ["Query.menus", "Mutation.menuUpdate(id)", "Mutation.menuUpdate(title)", "Mutation.menuUpdate(items)", "MenuItemUpdateInput.title", "MenuItemUpdateInput.type",
    "MenuItemUpdateInput.resourceId", "MenuItemUpdateInput.url", "MenuItemUpdateInput.items", "MenuItemUpdateInput.id"],
  publish: ["Query.publications", "Mutation.publishablePublish(id)", "Mutation.publishablePublish(input)", "PublicationInput.publicationId"],
  rollback: ["Mutation.productUpdate(product)", "ProductUpdateInput.id", "ProductUpdateInput.status", "Mutation.publishableUnpublish(input)", "Mutation.pageUpdate(page)"],
  delete: ["Mutation.productDelete(input)", "Mutation.collectionDelete(input)", "Mutation.pageDelete(id)", "Mutation.metaobjectDelete(id)"],
};

// Scopes each part needs, and why (shown when one is missing).
export const SCOPES = {
  read_products: "find products and collections that already use a handle",
  write_products: "create and update products, variants and collections",
  write_content: "create the brand page",
  read_content: "find a page that already uses the handle",
  write_metaobject_definitions: "create the brand metaobject type",
  write_metaobjects: "save the brand's palette, story and USPs",
  read_metaobjects: "read back the brand metaobject",
  write_online_store_navigation: "add the brand to a menu (optional)",
  read_online_store_navigation: "read the menu before adding to it (optional)",
  write_publications: "publish to the Online Store channel (optional)",
  read_publications: "find the Online Store publication (optional)",
};
// Where a missing scope is added, by how the store was connected. A Dev
// Dashboard app gets new scopes from a released version, but a store it is
// already installed on keeps the old ones until they are approved in that
// store's admin, which asks when the app is opened there (shopify.dev,
// "Create apps using the Dev Dashboard" and "Manage access scopes").
export function scopeFix(auth) {
  return auth === "client_credentials"
    ? "In Shopify's Dev Dashboard, open the app, create a new version with these scopes added under Access scopes, and release it. Then open the app in this store's admin and approve the new access when Shopify asks: a store the app is already installed on keeps the old access until then, and the new version can take a few minutes to reach it. Then check the store again here."
    : "Add these Admin API scopes to the app where it was made and install the update on the store. Then check the store again here; if Shopify gave you a new token, connect the store again with it.";
}
export const SCOPES_FOR = {
  product: ["read_products", "write_products"],
  collection: ["read_products", "write_products"],
  metaobject: ["write_metaobject_definitions", "write_metaobjects", "read_metaobjects"],
  page: ["read_content", "write_content"],
  menu: ["read_online_store_navigation", "write_online_store_navigation"],
  publish: ["read_publications", "write_publications"],
};
