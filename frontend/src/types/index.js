// Type definitions (JSDoc style for lightweight JS)

/**
 * @typedef {Object} Unit
 * @property {string} id
 * @property {string} name
 * @property {string} abbreviation
 * @property {number} conversionFactor - relative to base unit (pieces)
 * @property {boolean} isBase
 */

/**
 * @typedef {Object} InventoryItem
 * @property {string} id
 * @property {string} sku
 * @property {string} name
 * @property {string} description
 * @property {string} category
 * @property {number} quantity - in base units (pieces)
 * @property {string} baseUnitId
 * @property {Object<string, number>} [unitsPerBase] - for units that are a part of the base unit: how many make ONE base unit (Piece: 48 per pack)
 * @property {string[]} unitIds - units this item can be received/issued/returned in (base unit always included)
 * @property {number} reorderLevel
 * @property {string} location
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {string} itemId
 * @property {'receive' | 'issue'} type
 * @property {number} quantity - in base units
 * @property {string} unitId
 * @property {number} unitQuantity - quantity in the selected unit
 * @property {string} source - 'head_office' | 'vendor' | 'event' | 'site'
 * @property {string} [eventId]
 * @property {string} [vendor]
 * @property {string} [notes]
 * @property {string} performedBy
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Event
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} location
 * @property {string} startDate
 * @property {string} endDate
 * @property {'upcoming' | 'active' | 'completed'} status
 */

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} username
 * @property {string} name
 * @property {'admin' | 'staff'} role
 */

/**
 * @typedef {Object} KitComponent  - one piece of a kit (e.g. "Flat screwdriver")
 * @property {string} id
 * @property {string} name
 * @property {number} quantityPerKit - how many are in ONE complete set
 * @property {number} loose          - pieces in store that are not inside a complete set
 * @property {number} available      - in store: sets * quantityPerKit + loose
 * @property {number} outstanding    - currently issued out and not yet returned
 */

/**
 * Kit items (itemType 'kit') additionally have:
 * @property {KitComponent[]} components
 * @property {number} componentPieces - total pieces in one set
 * @property {number} loosePieces     - loose pieces across all components
 * @property {number} repackableSets  - complete sets that could be made from loose pieces
 *
 * Transactions on a kit may carry componentId/componentName (a single piece) and
 * parentTxnId (a piece line written by a whole-kit issue/return).
 */
