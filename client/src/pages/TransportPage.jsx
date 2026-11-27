import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import CrudManager from '../components/CrudManager';
import Modal from '../components/Modal';
import IconButton from '../components/IconButton';
import { todayStr } from '../utils/useRefs';
import DateInput from '../components/DateInput';

export default function TransportPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('transport', 'manage');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'routes';
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.get('/transport/vehicles').then(setVehicles).catch(() => {});
    api.get('/transport/routes').then(setRoutes).catch(() => {});
  }, [reload, tab]);

  const vehicleOptions = vehicles.map((v) => ({ value: String(v.id), label: `${v.vehicle_no}${v.driver_name ? ` — ${v.driver_name}` : ''}` }));
  const routeOptions = routes.map((r) => ({ value: String(r.id), label: `${r.name} (${Number(r.monthly_fee).toFixed(0)}/month)` }));

  return (
    <div>
      <div className="page-header"><h2>Transport</h2></div>
      <div className="row" style={{ marginBottom: 16 }}>
        {[['routes', 'Routes'], ['students', 'Students on Transport'], ['vehicles', 'Vehicles & Drivers']].map(([k, l]) => (
          <button key={k} type="button" className={tab === k ? '' : 'btn-ghost'} onClick={() => setParams({ tab: k }, { replace: true })}>{l}</button>
        ))}
      </div>

      {tab === 'routes' && (
        <CrudManager
          endpoint="/transport/routes"
          noun="route"
          addLabel="Add Route"
          canManage={canManage}
          onLoaded={setRoutes}
          fields={[
            { key: 'name', label: 'Route name', required: true, placeholder: 'e.g. Route 1 — Model Town' },
            { key: 'vehicle_id', label: 'Vehicle', type: 'select', options: vehicleOptions, blankLabel: '— not set —' },
            { key: 'monthly_fee', label: 'Monthly fee', type: 'number', min: 0, required: true, default: 0, hint: 'Added to each student’s fee invoice automatically' },
            { key: 'morning_time', label: 'Pick-up time', type: 'time' },
            { key: 'return_time', label: 'Drop-off time', type: 'time' },
            { key: 'stops', label: 'Stops (one per line)', type: 'textarea', full: true, rows: 4 }
          ]}
          columns={[
            { key: 'name', label: 'Route', render: (r) => <b>{r.name}</b> },
            { key: 'vehicle_no', label: 'Vehicle', render: (r) => (r.vehicle_no ? <>{r.vehicle_no}<div className="muted" style={{ fontSize: '0.75rem' }}>{r.driver_name} {r.driver_phone}</div></> : '—') },
            { key: 'times', label: 'Timing', render: (r) => [r.morning_time, r.return_time].filter(Boolean).join(' / ') || '—' },
            { key: 'stops', label: 'Stops', render: (r) => <span className="muted" style={{ fontSize: '0.8rem' }}>{(r.stops || '').split('\n').filter(Boolean).join(' → ') || '—'}</span> },
            { key: 'monthly_fee', label: 'Monthly fee', render: (r) => Number(r.monthly_fee).toFixed(2) },
            { key: 'students', label: 'Students', render: (r) => <>{r.students}{r.capacity ? <span className="muted"> / {r.capacity}</span> : ''}</> }
          ]}
          toPayload={(b) => ({ ...b, vehicle_id: b.vehicle_id ? Number(b.vehicle_id) : null, monthly_fee: Number(b.monthly_fee || 0) })}
          emptyMessage="No routes yet. Add vehicles first, then routes."
          describe={(r) => r.name}
        />
      )}

      {tab === 'vehicles' && (
        <CrudManager
          endpoint="/transport/vehicles"
          noun="vehicle"
          addLabel="Add Vehicle"
          canManage={canManage}
          onLoaded={setVehicles}
          fields={[
            { key: 'vehicle_no', label: 'Vehicle number', required: true, placeholder: 'e.g. LES-1234' },
            { key: 'model', label: 'Type / model', placeholder: 'e.g. Toyota Coaster' },
            { key: 'capacity', label: 'Seats', type: 'number', min: 1 },
            { key: 'driver_name', label: 'Driver name' },
            { key: 'driver_phone', label: 'Driver phone', type: 'tel' },
            { key: 'driver_license', label: 'Driver licence no.' },
            { key: 'conductor_name', label: 'Conductor / attendant' },
            { key: 'conductor_phone', label: 'Conductor phone', type: 'tel' }
          ]}
          columns={[
            { key: 'vehicle_no', label: 'Vehicle', render: (r) => <><b>{r.vehicle_no}</b><div className="muted" style={{ fontSize: '0.75rem' }}>{r.model}</div></> },
            { key: 'capacity', label: 'Seats' },
            { key: 'driver_name', label: 'Driver', render: (r) => <>{r.driver_name}<div className="muted" style={{ fontSize: '0.75rem' }}>{r.driver_phone} {r.driver_license ? `· Lic ${r.driver_license}` : ''}</div></> },
            { key: 'conductor_name', label: 'Conductor', render: (r) => <>{r.conductor_name}<div className="muted" style={{ fontSize: '0.75rem' }}>{r.conductor_phone}</div></> },
            { key: 'routes', label: 'Routes' }
          ]}
          toPayload={(b) => ({ ...b, capacity: b.capacity ? Number(b.capacity) : null })}
          emptyMessage="No vehicles yet."
          describe={(r) => r.vehicle_no}
        />
      )}

      {tab === 'students' && <StudentsOnTransport routes={routes} routeOptions={routeOptions} canManage={canManage} toast={toast} onChange={() => setReload((r) => r + 1)} />}
    </div>
  );
}

function StudentsOnTransport({ routes, routeOptions, canManage, toast, onChange }) {
  const [rows, setRows] = useState([]);
  const [routeId, setRouteId] = useState('');
  const [assign, setAssign] = useState(null);
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => { api.get(`/transport/students?route_id=${routeId}`).then(setRows).catch((e) => toast.error(e.message)); }, [routeId, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (assign && !students.length) api.get('/students?limit=2000').then((d) => setStudents(d.rows || [])).catch(() => {});
  }, [assign]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e) {
    e.preventDefault();
    try {
      await api.post('/transport/students', { ...assign, student_id: Number(assign.student_id), route_id: Number(assign.route_id) });
      toast.success('Student added to the route — the fare will be billed with fee invoices');
      setAssign(null);
      setTick((t) => t + 1);
      onChange();
    } catch (err) { toast.error(err.message); }
  }

  async function stop(r) {
    const end = window.prompt(`Last day ${r.full_name} uses transport (YYYY-MM-DD):`, todayStr());
    if (!end) return;
    try {
      await api.put(`/transport/students/${r.id}`, { end_date: end });
      toast.success('Transport stopped — no more transport fee from the next invoice');
      setTick((t) => t + 1);
      onChange();
    } catch (err) { toast.error(err.message); }
  }

  const shown = students.filter((s) => `${s.full_name} ${s.student_code} ${s.class_name}`.toLowerCase().includes(search.toLowerCase())).slice(0, 200);
  const monthly = rows.reduce((s, r) => s + Number(r.fee || 0), 0);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 10px' }}>
        <div className="row filters" style={{ margin: 0 }}>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">All routes</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span className="muted">{rows.length} students · {monthly.toFixed(2)} per month</span>
        </div>
        {canManage && <button type="button" disabled={!routes.length} onClick={() => setAssign({ student_id: '', route_id: routeId, stop: '', monthly_fee: '', start_date: todayStr() })}>+ Add Student</button>}
      </div>
      <table>
        <thead><tr><th>Student</th><th>Class</th><th>Route</th><th>Stop</th><th>Monthly fee</th><th>Since</th><th>Parent</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.full_name}</b><div className="muted" style={{ fontSize: '0.75rem' }}>{r.student_code}</div></td>
              <td>{r.class_name} - {r.section_name}</td><td>{r.route_name}</td><td>{r.stop || '—'}</td>
              <td>{Number(r.fee).toFixed(2)}{r.monthly_fee !== null && r.monthly_fee !== undefined && <span className="muted" title="Special fare for this student"> *</span>}</td>
              <td>{r.start_date}{r.end_date && <div className="muted" style={{ fontSize: '0.72rem' }}>until {r.end_date}</div>}</td>
              <td>{r.parent_name}<div className="muted" style={{ fontSize: '0.75rem' }}>{r.parent_phone}</div></td>
              <td>{canManage && !r.end_date && <IconButton icon="ban" tone="danger" label="Stop transport" onClick={() => stop(r)} />}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No students on transport{routeId ? ' for this route' : ''}.</td></tr>}
        </tbody>
      </table>
      {assign && (
        <Modal title="Add Student to Transport" onClose={() => setAssign(null)}>
          <form onSubmit={save}>
            <div className="field"><label>Find student</label><input placeholder="Name, ID or class…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="field"><label>Student</label>
              <select required size={6} value={assign.student_id} onChange={(e) => setAssign({ ...assign, student_id: e.target.value })}>
                {shown.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.class_name}-{s.section_name}) · {s.student_code}</option>)}
              </select>
            </div>
            <div className="form-grid">
              <div className="field"><label>Route</label>
                <select required value={assign.route_id} onChange={(e) => setAssign({ ...assign, route_id: e.target.value })}>
                  <option value="">Select</option>{routeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Stop</label>
                <input list="stops-list" value={assign.stop} onChange={(e) => setAssign({ ...assign, stop: e.target.value })} />
                <datalist id="stops-list">{(routes.find((r) => String(r.id) === String(assign.route_id))?.stops || '').split('\n').filter(Boolean).map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="field"><label>Starts from</label><DateInput required value={assign.start_date} onChange={(e) => setAssign({ ...assign, start_date: e.target.value })} /></div>
              <div className="field"><label>Special monthly fee <span className="muted">(blank = route fee)</span></label><input type="number" min="0" step="any" value={assign.monthly_fee} onChange={(e) => setAssign({ ...assign, monthly_fee: e.target.value })} /></div>
            </div>
            <p className="muted" style={{ fontSize: '0.8rem' }}>If the student is already on another route, that ends the day before.</p>
            <div className="modal-footer"><button type="button" className="btn-ghost" onClick={() => setAssign(null)}>Cancel</button><button type="submit">Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
