// Shipment tracking pieces shared by the order modal, the support ticket
// page and the late orders panel: courier + AWB, the journey timeline, and the
// support order card with one-click contacts and the delivery-team log.
import React, { useEffect, useState } from 'react';
import { ExternalLink, Truck, Store, User } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, Field } from '../ui';
import { ContactButtons, shortId } from './late-orders';

const SOURCE = { COURIER: 'Courier', ADMIN: 'Admin', SUPPORT: 'Support', CUSTOMER: 'Customer', SYSTEM: 'System' };
const BAD = ['DELIVERY_FAILED', 'RTO_INITIATED', 'RTO_DELIVERED', 'ISSUE_REPORTED'];
export const KIND_LABEL = { GENERAL: 'General', NOT_RECEIVED: 'Not received', DAMAGED: 'Damaged', WRONG_ITEM: 'Wrong item', OTHER: 'Other' };

/** "2h ago" style age. */
export function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** "Delhivery · AWB 123 · Track" or nothing when no courier is set. */
export function TrackingLine({ order }) {
  if (!order.courierName && !order.trackingNumber) return null;
  return <small>Courier: <strong>{order.courierName || '-'}</strong>{order.trackingNumber && <> · AWB <strong>{order.trackingNumber}</strong></>}{order.trackingUrl && <> · <a href={order.trackingUrl} target="_blank" rel="noreferrer">Track <ExternalLink size={11} style={{ verticalAlign: -1 }}/></a></>}</small>;
}

/** The vertical journey, oldest first. */
export function Journey({ events }) {
  if (!events?.length) return <p className="muted" style={{ margin: '4px 0' }}>No tracking updates yet.</p>;
  return <ol className="journey" aria-label="Delivery journey">{events.map(e => <li key={e.id} className={BAD.includes(e.status) ? 'bad' : e.status === 'DELIVERED' ? 'good' : ''}>
    <div className="journey-head"><strong>{e.title}</strong><small>{new Date(e.occurredAt).toLocaleString('en-IN')}</small></div>
    <small>{[e.location, e.note].filter(Boolean).join(' · ')}{(e.location || e.note) ? ' · ' : ''}<span className="journey-src">{SOURCE[e.source] || e.source}</span></small>
  </li>)}</ol>;
}

/** Order modal: courier form, journey, and the add-an-update form. */
export function ShipmentSection({ order, canEdit, canDeliver, busy, action }) {
  const [editing, setEditing] = useState(false);
  const has = order.courierName || order.trackingNumber;
  if (!canEdit && !has && !order.events?.length) return null;
  const send = (path, method, body, done, msg) => action(async () => { await api(`/support/orders/${order.id}/${path}`, { method, body }); done(); }, msg);
  const options = [['PICKED_UP', 'Picked up'], ['IN_TRANSIT', 'In transit'], ['OUT_FOR_DELIVERY', 'Out for delivery'], ['DELIVERY_FAILED', 'Delivery failed'], ...(canDeliver ? [['DELIVERED', 'Delivered']] : []), ['RTO_INITIATED', 'Return to seller started'], ['RTO_DELIVERED', 'Returned to seller'], ['UPDATE', 'Other note']];
  return <section className="shipment" aria-label="Shipment">
    <h3><Truck size={15} style={{ verticalAlign: -2 }}/> Shipment</h3>
    {has && !editing ? <div style={{ marginBottom: 8 }}><TrackingLine order={order}/>{canEdit && <button type="button" className="text-button" onClick={() => setEditing(true)}>Edit courier details</button>}</div>
      : canEdit ? <form className="editor" style={{ marginTop: 0 }} onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); send('tracking', 'PUT', { courierName: f.courier.trim(), trackingNumber: f.awb.trim(), trackingUrl: f.url.trim() || undefined }, () => setEditing(false), 'Courier details saved'); }}>
        <div className="form-grid"><Field label="Courier" name="courier" defaultValue={order.courierName || ''} required maxLength={80} placeholder="e.g. Delhivery"/><Field label="Tracking number (AWB)" name="awb" defaultValue={order.trackingNumber || ''} required maxLength={60}/></div>
        <Field label="Tracking link (optional)" name="url" type="url" defaultValue={order.trackingUrl || ''} maxLength={300} placeholder="https://..."/>
        <Button disabled={busy}>Save courier details</Button>{editing && <button type="button" className="text-button" style={{ display: 'inline-flex', marginLeft: 12 }} onClick={() => setEditing(false)}>Cancel</button>}
      </form> : null}
    <Journey events={order.events}/>
    {canEdit && order.status !== 'CANCELLED' && order.status !== 'DELIVERED' && <form className="editor journey-add" onSubmit={e => { e.preventDefault(); const form = e.target; const f = Object.fromEntries(new FormData(form)); send('events', 'POST', { status: f.status, note: f.note.trim() || undefined, location: f.location.trim() || undefined }, () => form.reset(), 'Update added'); }}>
      <strong>Add update</strong>
      <div className="form-grid"><label className="field"><span>Status</span><select name="status" defaultValue="IN_TRANSIT">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><Field label="Location (optional)" name="location" maxLength={120} placeholder="e.g. Jaipur Hub"/></div>
      <Field label="Note (needed for Other note)" name="note" maxLength={300}/>
      <Button secondary disabled={busy}>Add to journey</Button>
    </form>}
  </section>;
}

const teamText = (o, t) => `Order #${shortId(o.id)}${o.customer?.name ? ` for ${o.customer.name}` : ''}: the customer reports "${KIND_LABEL[t.kind] || 'a problem'}". Courier: ${o.courierName || 'not set'}${o.trackingNumber ? `, AWB ${o.trackingNumber}` : ''}. Please check where it is and update us.`;

/** Support ticket: the linked order, contacts, and the delivery-team log. */
export function TicketOrderCard({ ticket, busy, onDeliveryTeam }) {
  const [o, setO] = useState(null), [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api(`/support/orders/${ticket.orderId}`).then(r => { if (live) { setO(r); setErr(''); } }).catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [ticket.orderId, ticket.updatedAt, ticket.messages?.length]);
  if (err) return <div role="alert" className="alert">{err}</div>;
  if (!o) return <p className="muted">Loading order...</p>;
  const cust = o.customer || {};
  const team = o.deliveryTeamPhone;
  return <div className="ticket-order">
    <header><strong>Order #{shortId(o.id)}</strong> <Badge>{o.status}</Badge>{ticket.awaitingDeliveryTeam && <span className="late-chip">Waiting on delivery team</span>}</header>
    {(o.items || []).map((i, k) => <small key={k}>{i.quantity} × {i.name} · {i.sellerName ? `Sold by ${i.sellerName}` : 'NTSA’s own stock'}</small>)}
    <TrackingLine order={o}/>
    <Journey events={o.events}/>
    <div className="late-actions" style={{ marginTop: 10 }}>
      <div className="late-row"><span><Truck size={13}/> Delivery team</span><ContactButtons phone={team} message={teamText(o, ticket)} label="the delivery team"/></div>
      {!team && <small className="muted">The delivery team’s number is set from the Late orders panel (admin Overview).</small>}
      <div className="late-row"><span><User size={13}/> {cust.name || 'Customer'}</span><ContactButtons phone={cust.phone} message={`Hello ${cust.name || ''}, this is NTSA support about your order #${shortId(o.id)}.`} label="the customer"/></div>
      {(o.sellers || []).map(s => <div className="late-row" key={s.id}><span><Store size={13}/> {s.shopName}</span><ContactButtons phone={s.phone} message={`Hello ${s.shopName}, order #${shortId(o.id)} that includes your product(s) has a customer complaint (${KIND_LABEL[ticket.kind] || 'issue'}). Please check on your side.`} label={s.shopName}/></div>)}
    </div>
    {ticket.status === 'OPEN' && <div className="team-log">
      <strong>Delivery team log</strong><small>Saved as an internal note. The customer cannot see this.</small>
      {[['SENT', 'I asked the delivery team', 'What did you ask them?'], ['REPLY', 'Delivery team replied', 'What did they say?']].map(([dir, label, ph]) => <form key={dir} onSubmit={e => { e.preventDefault(); const f = e.target.elements.body; const body = f.value.trim(); if (!body) return; onDeliveryTeam(ticket, dir, body, () => { f.value = ''; }); }}>
        <input name="body" aria-label={label} placeholder={ph} maxLength={500}/><Button secondary disabled={busy}>{label}</Button>
      </form>)}
    </div>}
  </div>;
}
