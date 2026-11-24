export function mapTxn(r) {
  return {
    id: r.id,
    itemId: r.item_id,
    type: r.type,
    quantity: Math.round(Number(r.quantity) * 1e8) / 1e8, // drop rounding dust (0.9999999984 -> 1)
    unitId: r.unit_id,
    unitQuantity: Number(r.unit_quantity),
    source: r.source,
    eventId: r.event_id,
    vendor: r.vendor,
    recipient: r.recipient,
    department: r.department,
    notes: r.notes,
    performedBy: r.performed_by,
    createdAt: r.created_at,
    // Kit tracing: set when the line concerns one component of a kit, and
    // parentTxnId links component lines created by a whole-kit issue/return
    // back to the kit-level line.
    componentId: r.component_id || null,
    componentName: r.component_name || null,
    parentTxnId: r.parent_txn_id || null,
  }
}
