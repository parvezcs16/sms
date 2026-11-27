import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Badge from '../components/Badge';
import ShareButtons from '../components/ShareButtons';
import Modal from '../components/Modal';
import HistoryModal from '../components/HistoryModal';
import IconButton from '../components/IconButton';
import StatCard from '../components/StatCard';
import { useAuth } from '../context/AuthContext';
import { PAYMENT_MODES, needsReference, referenceLabel, fmtDateTime } from '../utils/payment';

const now = new Date();
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const amt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function PayrollPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [paying, setPaying] = useState(null);
  const [employeeType, setEmployeeType] = useState('teacher'); // 'teacher' | 'staff' — same page, same workflow, different roster
  const isStaff = employeeType === 'staff';
  const idField = isStaff ? 'staff_id' : 'teacher_id';
  const nameField = isStaff ? 'staff_name' : 'teacher_name';
  const base = isStaff ? '/payroll/staff' : '/payroll';

  const [tab, setTab] = useState('runs');
  const [employees, setEmployees] = useState([]);
  const [runs, setRuns] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [structureEmployeeId, setStructureEmployeeId] = useState('');
  const [structureForm, setStructureForm] = useState({ basic_salary: '', allowances: [], deductions: [] });
  const [advanceForm, setAdvanceForm] = useState({ amount: '', reason: '', recovery_per_month: '' });
  const [advanceEmployeeId, setAdvanceEmployeeId] = useState('');
  const [runForm, setRunForm] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [editRun, setEditRun] = useState(null);
  const [editAdvance, setEditAdvance] = useState(null);
  const [history, setHistory] = useState(null);
  const runEntity = isStaff ? 'staff_payroll_run' : 'payroll_run';

  async function loadAll() {
    const [e, r, a] = await Promise.all([
      api.get(isStaff ? '/staff?limit=200' : '/teachers?limit=200'),
      api.get(`${base}/runs`),
      api.get(`${base}/advances`)
    ]);
    setEmployees(e.rows); setRuns(r); setAdvances(a);
    setStructureEmployeeId(''); setAdvanceEmployeeId('');
    setStructureForm({ basic_salary: '', allowances: [], deductions: [] });
  }
  useEffect(() => { loadAll(); }, [employeeType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStructure(employeeId) {
    setStructureEmployeeId(employeeId);
    if (!employeeId) return;
    const structure = await api.get(`${base}/structures/${employeeId}`);
    setStructureForm(structure ? { basic_salary: structure.basic_salary, allowances: JSON.parse(structure.allowances_json), deductions: JSON.parse(structure.deductions_json) } : { basic_salary: '', allowances: [], deductions: [] });
  }

  async function saveStructure(e) {
    e.preventDefault();
    try {
      await api.post(`${base}/structures`, { [idField]: structureEmployeeId, basic_salary: Number(structureForm.basic_salary), allowances: structureForm.allowances, deductions: structureForm.deductions });
      toast.success('Salary structure saved');
    } catch (err) {
      toast.error(err.message);
    }
  }

  function addLine(type) {
    setStructureForm({ ...structureForm, [type]: [...structureForm[type], { label: '', amount: 0 }] });
  }
  function updateLine(type, idx, field, value) {
    const lines = [...structureForm[type]];
    lines[idx] = { ...lines[idx], [field]: field === 'amount' ? Number(value) : value };
    setStructureForm({ ...structureForm, [type]: lines });
  }

  async function submitAdvance(e) {
    e.preventDefault();
    try {
      await api.post(`${base}/advances`, { [idField]: advanceEmployeeId, amount: Number(advanceForm.amount), recovery_per_month: Number(advanceForm.recovery_per_month), reason: advanceForm.reason });
      toast.success('Advance recorded');
      setAdvanceForm({ amount: '', reason: '', recovery_per_month: '' });
      setAdvanceEmployeeId('');
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function runBulkPayroll(e) {
    e.preventDefault();
    try {
      const result = await api.post(`${base}/run-bulk`, runForm);
      toast.success(`Generated ${result.generated} payslips`);
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function markPaid(e) {
    e.preventDefault();
    try {
      const res = await api.put(`${base}/runs/${paying.id}/mark-paid`, { payment_mode: paying.payment_mode, payment_reference: paying.payment_reference });
      toast.success(`Salary paid to ${paying[nameField]} by ${res.payment_mode} — recorded under ${res.paid_by_name} at ${fmtDateTime(res.paid_at)}`);
      setPaying(null);
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function approve(r, undo = false) {
    if (!undo && !window.confirm(`Approve the ${r.month}/${r.year} salary of ${r[nameField]} (${r.net_salary.toFixed(2)})? Your name, designation and the time will be recorded.`)) return;
    if (undo && !window.confirm(`Remove the approval by ${r.approved_by_name} from this payslip?`)) return;
    try {
      await api.put(`${base}/runs/${r.id}/${undo ? 'unapprove' : 'approve'}`, {});
      toast.success(undo ? 'Approval removed' : 'Salary approved');
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function markUnpaid(r) {
    if (!window.confirm(`Mark the ${r.month}/${r.year} payslip for ${r[nameField]} as NOT paid?`)) return;
    try {
      await api.put(`${base}/runs/${r.id}/mark-unpaid`, {});
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function saveRun(e) {
    e.preventDefault();
    try {
      const result = await api.put(`${base}/runs/${editRun.id}`, {
        basic: Number(editRun.basic), total_allowances: Number(editRun.total_allowances), total_deductions: Number(editRun.total_deductions), remarks: editRun.remarks
      });
      toast.success(`Payslip corrected — net salary ${result.net_salary.toFixed(2)}`);
      setEditRun(null);
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deleteRun(r) {
    const extra = r.advance_deduction > 0 ? ` The ${r.advance_deduction.toFixed(2)} advance recovery on it will be added back to the advance balance.` : '';
    if (!window.confirm(`Delete the ${r.month}/${r.year} payslip ${r.payslip_number} for ${r[nameField]}? You can then generate it again.${extra}`)) return;
    try {
      await api.del(`${base}/runs/${r.id}`);
      toast.success('Payslip deleted');
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function saveAdvance(e) {
    e.preventDefault();
    try {
      await api.put(`${base}/advances/${editAdvance.id}`, { amount: Number(editAdvance.amount), recovery_per_month: Number(editAdvance.recovery_per_month), reason: editAdvance.reason });
      toast.success('Advance updated');
      setEditAdvance(null);
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deleteAdvance(a) {
    if (!window.confirm(`Delete this advance of ${a.amount} for ${a[nameField]}?`)) return;
    try {
      await api.del(`${base}/advances/${a.id}`);
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function sendPayslip(id) {
    try {
      const result = await api.post(`${base}/runs/${id}/send-payslip`, {});
      toast.success(`Payslip sent (${result.summary.sent} delivered, ${result.summary.simulated} simulated)`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Payroll</h2>
        <div className="row" style={{ margin: 0 }}>
          <button type="button" className={!isStaff ? '' : 'btn-ghost'} onClick={() => setEmployeeType('teacher')}>Teachers</button>
          <button type="button" className={isStaff ? '' : 'btn-ghost'} onClick={() => setEmployeeType('staff')}>Non-Teaching Staff</button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'runs' ? '' : 'btn-ghost'} onClick={() => setTab('runs')}>Payroll Runs</button>
        <button type="button" className={tab === 'structures' ? '' : 'btn-ghost'} onClick={() => setTab('structures')}>Salary Structures</button>
        <button type="button" className={tab === 'advances' ? '' : 'btn-ghost'} onClick={() => setTab('advances')}>Advances / Loans</button>
      </div>

      {tab === 'runs' && (() => {
        // KPIs for the month picked under "Run Payroll".
        const inMonth = runs.filter((r) => Number(r.month) === Number(runForm.month) && Number(r.year) === Number(runForm.year));
        const total = inMonth.reduce((s, r) => s + Number(r.net_salary || 0), 0);
        const paidRuns = inMonth.filter((r) => r.status === 'Paid');
        const paid = paidRuns.reduce((s, r) => s + Number(r.net_salary || 0), 0);
        const label = `${MONTH_NAMES[Number(runForm.month) - 1] || runForm.month} ${runForm.year}`;
        return (
          <div className="kpi-grid auto" style={{ marginBottom: 16 }}>
            <StatCard tone="students" icon="wallet" label="Total Amount" value={amt(total)} sub={`${inMonth.length} payslip${inMonth.length === 1 ? '' : 's'} · ${label}`} />
            <StatCard tone="teachers" icon="check" label="Paid" value={amt(paid)} sub={`${paidRuns.length} paid`} />
            <StatCard tone="absent" icon="clock" label="Pending Pays" value={amt(total - paid)} sub={`${inMonth.length - paidRuns.length} not paid yet`} />
          </div>
        );
      })()}

      {tab === 'runs' && (
        <div>
          <div className="card">
            <h3>Run Payroll</h3>
            <form onSubmit={runBulkPayroll} className="row">
              <input type="number" style={{ maxWidth: 100 }} value={runForm.month} onChange={(e) => setRunForm({ ...runForm, month: Number(e.target.value) })} placeholder="Month" />
              <input type="number" style={{ maxWidth: 120 }} value={runForm.year} onChange={(e) => setRunForm({ ...runForm, year: Number(e.target.value) })} placeholder="Year" />
              <button type="submit">Run Payroll for All Active {isStaff ? 'Staff' : 'Teachers'}</button>
            </form>
          </div>
          <div className="card">
            <table>
              <thead><tr><th>{isStaff ? 'Staff' : 'Teacher'}</th><th>Period</th><th>Net Salary</th><th>Status</th><th>Payment</th><th>Approved / Verified</th><th>Payslip</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r[nameField]}</td><td>{r.month}/{r.year}</td><td>{r.net_salary.toFixed(2)}</td>
                    <td><Badge>{r.status}</Badge></td>
                    <td>{r.status === 'Paid' ? (
                      <span style={{ fontSize: '0.82rem' }}>
                        {r.payment_mode || '—'}{r.payment_reference ? ` · ${r.payment_reference}` : ''}
                        <div className="muted" style={{ fontSize: '0.72rem' }}>{fmtDateTime(r.paid_at)}{r.paid_by_name ? ` · by ${r.paid_by_name}` : ''}</div>
                      </span>
                    ) : <span className="muted">—</span>}</td>
                    <td>{r.approved_at ? (
                      <span style={{ fontSize: '0.82rem' }}>✔ {r.approved_by_name}
                        <div className="muted" style={{ fontSize: '0.72rem' }}>{r.approved_by_designation} · {fmtDateTime(r.approved_at)}</div>
                      </span>
                    ) : <span className="muted" style={{ fontSize: '0.8rem' }}>Not yet</span>}</td>
                    <td><div className="actions-cell">
                      <ShareButtons iconOnly path={`${base}/runs/${r.id}/payslip.pdf`} filenameBase={`payslip-${r.payslip_number}`} />
                      <IconButton icon="send" tone="default" label="Send via WhatsApp / Email" onClick={() => sendPayslip(r.id)} />
                      {user.is_management && !r.approved_at && <IconButton icon="shield" tone="primary" label="Approve / verify" onClick={() => approve(r)} />}
                      {user.is_management && r.approved_at && <IconButton icon="ban" tone="default" label="Remove approval" onClick={() => approve(r, true)} />}
                      {r.status !== 'Paid' && <IconButton icon="pay" tone="success" label="Pay salary" onClick={() => setPaying({ ...r, payment_mode: 'Cash', payment_reference: '' })} />}
                      {r.status !== 'Paid' && <IconButton icon="edit" tone="primary" label="Edit" onClick={() => setEditRun({ ...r, remarks: r.remarks || '' })} />}
                      {r.status !== 'Paid' && <IconButton icon="trash" tone="danger" label="Delete" onClick={() => deleteRun(r)} />}
                      {r.status === 'Paid' && <IconButton icon="undo" tone="default" label="Mark unpaid" onClick={() => markUnpaid(r)} />}
                      <IconButton icon="history" tone="default" label="History" onClick={() => setHistory({ type: runEntity, id: r.id, title: `${r[nameField]} — ${r.month}/${r.year}` })} />
                    </div></td>
                  </tr>
                ))}
                {runs.length === 0 && <tr><td colSpan={7} className="muted">No payroll runs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'structures' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h3>Salary Structure</h3>
          <div className="field"><label>{isStaff ? 'Staff Member' : 'Teacher'}</label>
            <select value={structureEmployeeId} onChange={(e) => loadStructure(e.target.value)}>
              <option value="">Select</option>{employees.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </div>
          {structureEmployeeId && (
            <form onSubmit={saveStructure}>
              <div className="field"><label>Basic Salary</label><input type="number" required value={structureForm.basic_salary} onChange={(e) => setStructureForm({ ...structureForm, basic_salary: e.target.value })} /></div>

              <label>Allowances</label>
              {structureForm.allowances.map((a, i) => (
                <div key={i} className="row">
                  <input placeholder="Label" value={a.label} onChange={(e) => updateLine('allowances', i, 'label', e.target.value)} />
                  <input type="number" placeholder="Amount" value={a.amount} onChange={(e) => updateLine('allowances', i, 'amount', e.target.value)} />
                </div>
              ))}
              <button type="button" className="btn-ghost btn-sm" onClick={() => addLine('allowances')}>+ Add Allowance</button>

              <label style={{ marginTop: 14 }}>Deductions</label>
              {structureForm.deductions.map((d, i) => (
                <div key={i} className="row">
                  <input placeholder="Label" value={d.label} onChange={(e) => updateLine('deductions', i, 'label', e.target.value)} />
                  <input type="number" placeholder="Amount" value={d.amount} onChange={(e) => updateLine('deductions', i, 'amount', e.target.value)} />
                </div>
              ))}
              <button type="button" className="btn-ghost btn-sm" onClick={() => addLine('deductions')}>+ Add Deduction</button>

              <div style={{ marginTop: 16 }}><button type="submit">Save Structure</button></div>
            </form>
          )}
        </div>
      )}

      {tab === 'advances' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Advances / Loan Recovery</h3>
            <table>
              <thead><tr><th>{isStaff ? 'Staff' : 'Teacher'}</th><th>Amount</th><th>Monthly</th><th>Remaining</th><th>Status</th><th /></tr></thead>
              <tbody>{advances.map((a) => (
                <tr key={a.id}>
                  <td>{a[nameField]}</td><td>{a.amount}</td><td>{a.recovery_per_month}</td><td>{a.remaining_balance}</td><td><Badge>{a.status}</Badge></td>
                  <td><div className="actions-cell">
                    <IconButton icon="edit" tone="primary" label="Edit" onClick={() => setEditAdvance({ ...a, reason: a.reason || '' })} />
                    {a.remaining_balance >= a.amount && <IconButton icon="trash" tone="danger" label="Delete" onClick={() => deleteAdvance(a)} />}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="card">
            <h3>Record New Advance</h3>
            <form onSubmit={submitAdvance}>
              <div className="field"><label>{isStaff ? 'Staff Member' : 'Teacher'}</label>
                <select required value={advanceEmployeeId} onChange={(e) => setAdvanceEmployeeId(e.target.value)}>
                  <option value="">Select</option>{employees.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
              <div className="field"><label>Amount</label><input type="number" required value={advanceForm.amount} onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })} /></div>
              <div className="field"><label>Monthly Recovery</label><input type="number" required value={advanceForm.recovery_per_month} onChange={(e) => setAdvanceForm({ ...advanceForm, recovery_per_month: e.target.value })} /></div>
              <div className="field"><label>Reason</label><input value={advanceForm.reason} onChange={(e) => setAdvanceForm({ ...advanceForm, reason: e.target.value })} /></div>
              <button type="submit">Save Advance</button>
            </form>
          </div>
        </div>
      )}
      {paying && (
        <Modal title={`Pay Salary — ${paying[nameField]} (${paying.month}/${paying.year})`} onClose={() => setPaying(null)}>
          <form onSubmit={markPaid}>
            <p style={{ marginTop: 0 }}>Net salary: <b>{paying.net_salary.toFixed(2)}</b>{!paying.approved_at && <span className="muted"> · not approved yet</span>}</p>
            <div className="form-grid">
              <div className="field"><label>Payment Mode</label>
                <select value={paying.payment_mode} onChange={(e) => setPaying({ ...paying, payment_mode: e.target.value })}>
                  {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              {needsReference(paying.payment_mode) && (
                <div className="field"><label>{referenceLabel(paying.payment_mode)}</label>
                  <input required={paying.payment_mode === 'Cheque'} value={paying.payment_reference} onChange={(e) => setPaying({ ...paying, payment_reference: e.target.value })} />
                </div>
              )}
            </div>
            <p className="muted" style={{ fontSize: '0.8rem' }}>Paid by <b>{user.full_name}</b>. Your name and the exact date and time are saved and printed on the payslip in place of a signature.</p>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setPaying(null)}>Cancel</button>
              <button type="submit" className="btn-success">Confirm Payment</button>
            </div>
          </form>
        </Modal>
      )}

      {editRun && (
        <Modal title={`Correct Payslip — ${editRun[nameField]} (${editRun.month}/${editRun.year})`} onClose={() => setEditRun(null)}>
          <form onSubmit={saveRun}>
            <div className="form-grid">
              <div className="field"><label>Basic</label><input type="number" min="0" required value={editRun.basic} onChange={(e) => setEditRun({ ...editRun, basic: e.target.value })} /></div>
              <div className="field"><label>Allowances (total)</label><input type="number" min="0" required value={editRun.total_allowances} onChange={(e) => setEditRun({ ...editRun, total_allowances: e.target.value })} /></div>
              <div className="field"><label>Deductions (total)</label><input type="number" min="0" required value={editRun.total_deductions} onChange={(e) => setEditRun({ ...editRun, total_deductions: e.target.value })} /></div>
              <div className="field"><label>Advance recovery</label><input readOnly value={editRun.advance_deduction} /></div>
            </div>
            <div className="field"><label>Remarks (e.g. unpaid leave 2 days)</label><input value={editRun.remarks} onChange={(e) => setEditRun({ ...editRun, remarks: e.target.value })} /></div>
            <p><b>Net salary: {(Number(editRun.basic) + Number(editRun.total_allowances) - Number(editRun.total_deductions) - editRun.advance_deduction).toFixed(2)}</b></p>
            <p className="muted">To change the advance recovery, delete this payslip and generate it again after editing the advance.</p>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setEditRun(null)}>Cancel</button>
              <button type="submit">Save Correction</button>
            </div>
          </form>
        </Modal>
      )}
      {editAdvance && (
        <Modal title={`Edit Advance — ${editAdvance[nameField]}`} onClose={() => setEditAdvance(null)}>
          <form onSubmit={saveAdvance}>
            <div className="field"><label>Amount</label><input type="number" min="0" required value={editAdvance.amount} onChange={(e) => setEditAdvance({ ...editAdvance, amount: e.target.value })} /></div>
            <div className="field"><label>Monthly Recovery</label><input type="number" min="0" required value={editAdvance.recovery_per_month} onChange={(e) => setEditAdvance({ ...editAdvance, recovery_per_month: e.target.value })} /></div>
            <div className="field"><label>Reason</label><input value={editAdvance.reason} onChange={(e) => setEditAdvance({ ...editAdvance, reason: e.target.value })} /></div>
            <p className="muted">Already recovered: {(editAdvance.amount - editAdvance.remaining_balance).toFixed(2)}. The remaining balance is recalculated.</p>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setEditAdvance(null)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </Modal>
      )}
      {history && <HistoryModal entityType={history.type} entityId={history.id} title={`History — ${history.title}`} onClose={() => setHistory(null)} />}
    </div>
  );
}
