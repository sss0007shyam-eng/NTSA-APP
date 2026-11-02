// The delivery companies NTSA ships with. The courier used to be typed in on
// each order, so changing delivery company -- or fixing a courier's tracking
// link -- meant touching every order. A courier is set up once here, and the
// tracking link is a template: the backend builds each order's Track link from
// it on the way out, so editing the template re-points every order that
// courier is carrying.
import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, Empty, Field } from '../ui';

// What goes where the tracking number does. Spelled out here as well because
// it's the one thing an admin typing a template has to get right.
const AWB = '{awb}';
const SAMPLE_AWB = '1234567890';

/** The template with a made-up tracking number in it, so the admin can click it and check. */
const preview = template => template?.includes(AWB) ? template.replaceAll(AWB, SAMPLE_AWB) : null;

function CourierForm({ courier, busy, onSave, onCancel }) {
  const submit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    onSave({
      name: f.name.trim(), trackingUrlTemplate: f.template.trim(),
      contactPhone: f.phone.trim() || null, contactEmail: f.email.trim() || null,
      active: f.active === 'on', isDefault: f.isDefault === 'on',
    }, e.target);
  };
  return <form className="editor" style={{ marginBottom: 0 }} onSubmit={submit}>
    <div className="form-grid">
      <Field label="Courier name" name="name" defaultValue={courier?.name || ''} required minLength={2} maxLength={80} placeholder="e.g. Delhivery"/>
      <Field label="Contact phone (optional)" name="phone" defaultValue={courier?.contactPhone || ''} maxLength={16} placeholder="9876543210"/>
    </div>
    <Field label={`Tracking link — put ${AWB} where the tracking number goes`} name="template" type="url" defaultValue={courier?.trackingUrlTemplate || ''} required maxLength={500} placeholder={`https://www.delhivery.com/track/package/${AWB}`}/>
    <Field label="Contact email (optional)" name="email" type="email" defaultValue={courier?.contactEmail || ''} maxLength={200} placeholder="support@courier.com"/>
    <label className="checkbox"><input type="checkbox" name="active" defaultChecked={courier ? courier.active : true}/>Available for new shipments</label>
    <label className="checkbox"><input type="checkbox" name="isDefault" defaultChecked={courier?.isDefault || false}/>Offer this one first when a shipment is booked</label>
    <Button disabled={busy}>{courier ? 'Save courier' : 'Add courier'}</Button>
    {onCancel && <button type="button" className="text-button" style={{ display: 'inline-flex', marginLeft: 12 }} onClick={onCancel}>Cancel</button>}
  </form>;
}

export function CouriersPage({ couriers, busy, action }) {
  const [editing, setEditing] = useState(null);
  const save = (body, form) => action(async () => {
    await api(editing ? `/admin/couriers/${editing.id}` : '/admin/couriers', { method: editing ? 'PUT' : 'POST', body });
    if (editing) setEditing(null); else form.reset();
  }, editing ? 'Courier saved' : 'Courier added');
  const usable = couriers.filter(c => c.active).length;
  return <section className="panel">
    <div className="panel-heading"><div>
      <h2>Courier partners <span className="count">{couriers.length}</span></h2>
      <p>{usable} available for new shipments. Change a courier’s tracking link here and every order it is carrying follows — no code change.</p>
    </div></div>
    <div style={{ padding: '18px 22px' }}>
      {editing
        ? <CourierForm courier={editing} busy={busy} onSave={save} onCancel={() => setEditing(null)}/>
        : <CourierForm busy={busy} onSave={save}/>}
    </div>
    <div className="table-scroll"><table>
      <thead><tr><th>Courier</th><th>Tracking link</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{couriers.map(c => <tr key={c.id}>
        <td><strong>{c.name}</strong>{c.isDefault && <small style={{ color: '#418568', fontWeight: 600 }}>Offered first</small>}</td>
        <td style={{ maxWidth: 320 }}><small style={{ wordBreak: 'break-all' }}>{c.trackingUrlTemplate}</small>
          {preview(c.trackingUrlTemplate) && <small><a href={preview(c.trackingUrlTemplate)} target="_blank" rel="noreferrer">Try it with {SAMPLE_AWB} <ExternalLink size={11} style={{ verticalAlign: -1 }}/></a></small>}</td>
        <td><small>{c.contactPhone || '—'}</small>{c.contactEmail && <small>{c.contactEmail}</small>}</td>
        <td><Badge>{c.active ? 'Active' : 'Disabled'}</Badge></td>
        <td><div className="row-actions">
          <button disabled={busy} onClick={() => setEditing(c)}>Edit</button>
          {!c.isDefault && c.active && <button disabled={busy} onClick={() => action(() => api(`/admin/couriers/${c.id}`, { method: 'PUT', body: { isDefault: true } }), `${c.name} is now offered first`)}>Offer first</button>}
          <button disabled={busy} onClick={() => action(() => api(`/admin/couriers/${c.id}`, { method: 'PUT', body: { active: !c.active } }), c.active ? 'Courier switched off' : 'Courier switched on')}>{c.active ? 'Switch off' : 'Switch on'}</button>
          {/* Past orders keep the courier name they were booked under, so
              removing one never blanks out order history. */}
          <button className="danger-text" disabled={busy} onClick={() => action(() => api(`/admin/couriers/${c.id}`, { method: 'DELETE' }), 'Courier removed')}>Remove</button>
        </div></td>
      </tr>)}</tbody>
    </table></div>
    {!couriers.length && <Empty text="Add the first delivery company you ship with"/>}
  </section>;
}
