import React from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, Timestamp, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

// --- Constants ---
const CATEGORIES = [
  { value: 'grocery', label: '🛒 Grocery' }, { value: 'fun', label: '🎉 Fun' },
  { value: 'travel', label: '✈️ Travel' }, { value: 'daily_expense', label: '☕ Daily Expense' },
  { value: 'beverage', label: '🥤 Beverage' }, { value: 'business', label: '💼 Business' },
  { value: 'fitness', label: '💪 Fitness' }, { value: 'other', label: ' miscellaneous' },
];
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6EE7B7', '#93C5FD'];
const getCategoryLabel = (value) => (CATEGORIES.find(c => c.value === value) || {}).label || 'N/A';

// --- Main App Component ---
const App = () => {
  // --- State Management ---
  const [auth, setAuth] = React.useState(null);
  const [db, setDb] = React.useState(null);
  const [user, setUser] = React.useState(null); // Full user object from Firebase Auth
  const [isAuthReady, setIsAuthReady] = React.useState(false);
  const [expenses, setExpenses] = React.useState([]);
  const [incomes, setIncomes] = React.useState([]);
  const [formType, setFormType] = React.useState('expense');
  const [formState, setFormState] = React.useState({ amount: '', category: 'grocery', reason: '', date: new Date().toISOString().split('T')[0], source: '' });
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [currentMonth, setCurrentMonth] = React.useState(new Date());

  // --- UI State ---
  const [editingTransaction, setEditingTransaction] = React.useState(null);
  const [editFormState, setEditFormState] = React.useState(null);
  const [transactionToDelete, setTransactionToDelete] = React.useState(null);
  const [showGandhi, setShowGandhi] = React.useState(false);

  // --- Gemini API State ---
  const [advice, setAdvice] = React.useState('');
  const [isGeneratingAdvice, setIsGeneratingAdvice] = React.useState(false);
  const [adviceError, setAdviceError] = React.useState('');

  // --- Firebase Initialization & Auth ---
  React.useEffect(() => {
    try {
      const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
      if (!Object.keys(firebaseConfig).length) {
        setError("Firebase config missing. Deployment may require setting environment variables."); 
        setIsAuthReady(true);
        setLoading(false);
        return;
      }
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const authInstance = getAuth(app);
      setDb(firestoreDb);
      setAuth(authInstance);

      onAuthStateChanged(authInstance, (user) => {
        if (user) {
          setUser(user);
        } else {
          setUser(null);
        }
        setIsAuthReady(true);
        setLoading(false);
      });
    } catch (e) {
      console.error("Firebase init error:", e);
      setError("Failed to initialize app."); 
      setLoading(false);
      setIsAuthReady(true);
    }
  }, []);

  // --- Firestore Data Fetching ---
  React.useEffect(() => {
    if (!isAuthReady || !db || !user) {
        setExpenses([]);
        setIncomes([]);
        return;
    };
    
    setLoading(true);
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const userId = user.uid;

    const createSubscription = (type, setData) => {
      const collectionPath = `artifacts/${appId}/users/${userId}/${type}`;
      return onSnapshot(query(collection(db, collectionPath)), (snapshot) => {
        setData(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: type.slice(0, -1) })));
        setLoading(false);
      }, (err) => { console.error(err); setError(`Failed to load ${type}.`); setLoading(false); });
    };
    const unsubExpenses = createSubscription('expenses', setExpenses);
    const unsubIncomes = createSubscription('incomes', setIncomes);
    return () => { unsubExpenses(); unsubIncomes(); };
  }, [isAuthReady, db, user]);

  // --- Data Processing ---
  const { totalMonthlyExpense, totalMonthlyIncome, balance, expenseReportData, allTransactions } = React.useMemo(() => {
    const filterByMonth = (data) => data.filter(item => {
        const itemDate = item.date.toDate();
        return itemDate.getMonth() === currentMonth.getMonth() && itemDate.getFullYear() === currentMonth.getFullYear();
    });
    const monthlyExp = filterByMonth(expenses);
    const monthlyInc = filterByMonth(incomes);
    const totalExp = monthlyExp.reduce((sum, ex) => sum + ex.amount, 0);
    const totalInc = monthlyInc.reduce((sum, inc) => sum + inc.amount, 0);
    const categoryTotals = monthlyExp.reduce((acc, exp) => { acc[exp.category] = (acc[exp.category] || 0) + exp.amount; return acc; }, {});
    const reportData = Object.entries(categoryTotals).map(([name, value]) => ({ name: getCategoryLabel(name), value: parseFloat(value.toFixed(2)) }));
    const allTrans = [...expenses, ...incomes].sort((a, b) => b.date.toDate() - a.date.toDate());
    return { totalMonthlyExpense: totalExp, totalMonthlyIncome: totalInc, balance: totalInc - totalExp, expenseReportData: reportData, allTransactions: allTrans };
  }, [expenses, incomes, currentMonth]);

  // --- Auth Handlers ---
  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google Sign-In Error", error);
      setError("Could not sign in with Google. Please try again.");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign Out Error", error);
      setError("Failed to sign out.");
    }
  };

  // --- CRUD Handlers ---
  const handleFormChange = (e) => setFormState(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const handleAddTransaction = async (e) => {
    e.preventDefault();
    const { amount, category, reason, date, source } = formState;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setError(`Please enter a valid positive amount.`); return;
    }
    if (formType === 'income' && !source) {
        setError('Please enter an income source.'); return;
    }
    setError('');
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const colPath = `artifacts/${appId}/users/${user.uid}/${formType}s`;
      const data = formType === 'expense' 
        ? { amount: parseFloat(amount), category, reason, date: Timestamp.fromDate(new Date(date + 'T00:00:00')) }
        : { amount: parseFloat(amount), source, date: Timestamp.fromDate(new Date(date + 'T00:00:00')) };
      await addDoc(collection(db, colPath), data);
      setShowGandhi(true);
      setTimeout(() => setShowGandhi(false), 3000);
      setFormState({ amount: '', category: 'grocery', reason: '', date: new Date().toISOString().split('T')[0], source: '' });
    } catch (err) { console.error(`Error adding ${formType}:`, err); setError(`Failed to add ${formType}.`); }
  };

  const handleOpenEditModal = (transaction) => {
    setEditingTransaction(transaction);
    setEditFormState({
      amount: transaction.amount,
      date: transaction.date.toDate().toISOString().split('T')[0],
      category: transaction.category || '',
      reason: transaction.reason || '',
      source: transaction.source || '',
    });
  };
  
  const handleUpdateTransaction = async (e) => {
    e.preventDefault();
    if (!editingTransaction) return;
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const docRef = doc(db, `artifacts/${appId}/users/${user.uid}/${editingTransaction.type}s`, editingTransaction.id);
      const { amount, date, category, reason, source } = editFormState;
      const updatedData = { amount: parseFloat(amount), date: Timestamp.fromDate(new Date(date + 'T00:00:00')) };
      if (editingTransaction.type === 'expense') { Object.assign(updatedData, { category, reason }); } 
      else { Object.assign(updatedData, { source }); }
      await updateDoc(docRef, updatedData);
      setEditingTransaction(null);
    } catch (err) { console.error("Update error:", err); setError("Failed to update."); }
  };

  const handleDeleteTransaction = async () => {
    if (!transactionToDelete) return;
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const docRef = doc(db, `artifacts/${appId}/users/${user.uid}/${transactionToDelete.type}s`, transactionToDelete.id);
        await deleteDoc(docRef);
        setTransactionToDelete(null);
    } catch (err) { console.error("Delete error:", err); setError("Failed to delete."); setTransactionToDelete(null); }
  };
  
  const getFinancialAdvice = async () => {
    if (totalMonthlyExpense === 0 && totalMonthlyIncome === 0) {
      setAdviceError("Add some data for this month to get advice."); return;
    }
    setIsGeneratingAdvice(true); setAdvice(''); setAdviceError('');
    const spendingSummary = expenseReportData.map(item => `- ${item.name}: ₹${item.value.toFixed(2)}`).join('\n');
    const prompt = `Financial data for a user in India for ${currentMonth.toLocaleString('default', { month: 'long' })}: Total Income: ₹${totalMonthlyIncome.toFixed(2)}, Total Expenses: ₹${totalMonthlyExpense.toFixed(2)}. Spending Breakdown:\n${spendingSummary}\nProvide 3-4 clear, encouraging, actionable financial tips in a modern, friendly tone.`;
    try {
        const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
        const apiKey = "";
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`API error ${response.status}`);
        const result = await response.json();
        if (result.candidates?.[0]?.content.parts[0].text) {
            setAdvice(result.candidates[0].content.parts[0].text);
        } else { throw new Error("No content from API."); }
    } catch (error) { console.error("Gemini API error:", error); setAdviceError("Couldn't generate advice. Try again later.");
    } finally { setIsGeneratingAdvice(false); }
  };

  // --- Render Logic ---
  if (!isAuthReady) {
    return <div className="bg-[#101010] min-h-screen flex items-center justify-center text-white text-xl">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="bg-[#101010] min-h-screen flex flex-col items-center justify-center font-sans">
        <h1 className="text-5xl font-bold text-white tracking-tighter mb-4">cashflow</h1>
        <p className="text-gray-400 mb-8">master your money, one entry at a time.</p>
        <button onClick={handleGoogleSignIn} className="bg-white text-black font-semibold py-3 px-6 rounded-lg flex items-center space-x-3 hover:bg-gray-200 transition-colors">
          <svg className="w-6 h-6" viewBox="0 0 48 48"><path fill="#4285F4" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"></path><path fill="#34A853" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8V44c5.268 0 10.046-1.953 13.59-5.389l-5.657-5.657C30.154 35.846 27.341 36 24 36c-5.223 0-9.651-3.343-11.303-8H42v-8z"></path><path fill="#FBBC05" d="M12.697 28.703C12.233 27.525 12 26.295 12 25s.233-1.525.697-2.703l-5.657-5.657C4.953 19.954 4 21.928 4 24s.953 4.046 2.04 5.36l5.657-5.657z"></path><path fill="#EA4335" d="M24 36c3.341 0 6.154-.154 8.239-1.85l5.657 5.657C34.046 42.047 29.268 44 24 44c-5.268 0-10.046-1.953-13.59-5.389l5.657-5.657C14.349 32.657 18.777 36 24 36z"></path></svg>
          <span>Sign in with Google</span>
        </button>
        {error && <p className="text-red-400 mt-4">{error}</p>}
      </div>
    );
  }

  return (
    <div className="bg-[#101010] min-h-screen font-sans text-gray-200">
      <style>{`
        .bg-cred-dark { background-color: #1C1C1E; } .border-cred-dark { border-color: #2C2C2E; }
        .input-cred { background-color: #2C2C2E; border: 1px solid #444; color: #FFF; }
        .input-cred:focus { border-color: #A78BFA; outline: none; box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.5); }
        .btn-purple { background: linear-gradient(to right, #8B5CF6, #6D28D9); } .btn-green { background: linear-gradient(to right, #10B981, #059669); }
        .text-glow-green { text-shadow: 0 0 8px rgba(16, 185, 129, 0.7); } .text-glow-red { text-shadow: 0 0 8px rgba(239, 68, 68, 0.7); }
        .text-glow-blue { text-shadow: 0 0 8px rgba(59, 130, 246, 0.7); } .text-glow-yellow { text-shadow: 0 0 8px rgba(245, 158, 11, 0.7); }
        @keyframes popup { 0% { opacity: 0; transform: translateY(20px) scale(0.9); } 10% { opacity: 1; transform: translateY(0) scale(1); } 90% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(20px) scale(0.9); } }
        .animate-popup { animation: popup 3s ease-in-out forwards; }
      `}</style>
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <header className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tighter">cashflow</h1>
            <p className="text-gray-400 mt-1">welcome, {user.displayName || 'friend'}.</p>
          </div>
          <div className="flex items-center space-x-4">
            <img src={user.photoURL} alt="profile" className="w-12 h-12 rounded-full border-2 border-purple-500" />
            <button onClick={handleSignOut} className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors">Sign Out</button>
          </div>
        </header>

        {error && <div className="bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6" role="alert">{error}</div>}

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Entry Form */}
          <div className="lg:col-span-1 bg-cred-dark p-6 rounded-2xl border border-cred-dark">
            <div className="flex border-b border-cred-dark mb-6">
                <button onClick={() => setFormType('expense')} className={`flex-1 py-3 font-bold rounded-t-lg transition-all ${formType === 'expense' ? 'bg-purple-600/20 text-purple-300 border-b-2 border-purple-400' : 'text-gray-500'}`}>expense</button>
                <button onClick={() => setFormType('income')} className={`flex-1 py-3 font-bold rounded-t-lg transition-all ${formType === 'income' ? 'bg-green-600/20 text-green-300 border-b-2 border-green-400' : 'text-gray-500'}`}>income</button>
            </div>
            <form onSubmit={handleAddTransaction} className="space-y-4">
              <input type="number" name="amount" value={formState.amount} onChange={handleFormChange} placeholder="Amount (₹)" className="w-full input-cred p-3 rounded-lg"/>
              {formType === 'expense' ? (
                <>
                  <select name="category" value={formState.category} onChange={handleFormChange} className="w-full input-cred p-3 rounded-lg appearance-none">{CATEGORIES.map(c => <option className="bg-gray-800" key={c.value} value={c.value}>{c.label}</option>)}</select>
                  <input type="text" name="reason" value={formState.reason} onChange={handleFormChange} placeholder="Reason (Optional)" className="w-full input-cred p-3 rounded-lg"/>
                </>
              ) : (
                <input type="text" name="source" value={formState.source} onChange={handleFormChange} placeholder="Source (e.g., Salary)" className="w-full input-cred p-3 rounded-lg"/>
              )}
              <input type="date" name="date" value={formState.date} onChange={handleFormChange} className="w-full input-cred p-3 rounded-lg"/>
              <button type="submit" className={`w-full text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity ${formType === 'expense' ? 'btn-purple' : 'btn-green'}`}>add {formType}</button>
            </form>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-cred-dark p-6 rounded-2xl border border-cred-dark">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 border-b border-cred-dark pb-4">
                  <h2 className="text-2xl font-bold text-white mb-2 sm:mb-0">monthly summary</h2>
                  <div className="flex items-center space-x-2">
                      <button onClick={() => setCurrentMonth(d => new Date(d.setMonth(d.getMonth() - 1)))} className="p-2 rounded-md hover:bg-gray-700">&lt;</button>
                      <span className="font-semibold text-lg text-center text-gray-300">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                      <button onClick={() => setCurrentMonth(d => new Date(d.setMonth(d.getMonth() + 1)))} className="p-2 rounded-md hover:bg-gray-700">&gt;</button>
                  </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center mb-6">
                  <div className="bg-gray-900/50 p-4 rounded-lg border border-cred-dark"><h3 className="text-sm font-semibold text-green-400 uppercase tracking-widest">Income</h3><p className="text-2xl font-bold text-green-400 text-glow-green">₹{totalMonthlyIncome.toFixed(2)}</p></div>
                  <div className="bg-gray-900/50 p-4 rounded-lg border border-cred-dark"><h3 className="text-sm font-semibold text-red-400 uppercase tracking-widest">Expenses</h3><p className="text-2xl font-bold text-red-400 text-glow-red">₹{totalMonthlyExpense.toFixed(2)}</p></div>
                  <div className={`bg-gray-900/50 p-4 rounded-lg border border-cred-dark`}><h3 className={`text-sm font-semibold uppercase tracking-widest ${balance >= 0 ? 'text-blue-400' : 'text-yellow-400'}`}>Balance</h3><p className={`text-2xl font-bold ${balance >= 0 ? 'text-blue-400 text-glow-blue' : 'text-yellow-400 text-glow-yellow'}`}>₹{balance.toFixed(2)}</p></div>
              </div>
              
              <div className="mt-8">
                <button onClick={getFinancialAdvice} disabled={isGeneratingAdvice} className="w-full bg-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-purple-700 disabled:bg-purple-900/50 flex items-center justify-center transition-all">
                  {isGeneratingAdvice ? 'analyzing...' : 'get financial advice'}
                </button>
                {adviceError && <div className="mt-4 bg-yellow-900/50 border border-yellow-500 text-yellow-300 px-4 py-3 rounded-lg">{adviceError}</div>}
                {advice && <div className="mt-4 p-4 bg-purple-900/20 rounded-lg border border-purple-800"><h4 className="font-bold text-lg text-purple-300 mb-2">gemini says...</h4><p className="text-gray-300 whitespace-pre-wrap">{advice}</p></div>}
              </div>

              <h3 className="text-xl font-bold text-white mt-8 mb-4">expense breakdown</h3>
              {loading ? <div className="text-center py-8 text-gray-500">loading chart...</div> : expenseReportData.length > 0 ? (
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer><PieChart><Pie data={expenseReportData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} fill="#8884d8" paddingAngle={5}>{expenseReportData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={{backgroundColor: '#1C1C1E', border: '1px solid #2C2C2E'}} formatter={(value) => `₹${value.toFixed(2)}`} /><Legend wrapperStyle={{color: '#A1A1AA'}} /></PieChart></ResponsiveContainer>
                </div>
              ) : <div className="text-center py-8 text-gray-500">no expenses this month.</div>}
            </div>

            <div className="bg-cred-dark p-6 rounded-2xl border border-cred-dark">
              <h2 className="text-2xl font-bold text-white mb-4 border-b border-cred-dark pb-3">recent transactions</h2>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {loading ? <div className="text-center py-4 text-gray-500">loading...</div> : allTransactions.map(t => (
                    <div key={t.id} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-cred-dark flex-wrap hover:bg-gray-800/70 transition-colors">
                      <div className="flex-grow"><p className="font-bold text-white">{t.type === 'expense' ? getCategoryLabel(t.category) : 'Income'}</p><p className="text-sm text-gray-400">{t.reason || t.source}</p><p className="text-xs text-gray-500">{t.date.toDate().toLocaleDateString()}</p></div>
                      <div className="flex items-center ml-4"><p className={`font-bold text-lg sm:text-xl mr-4 ${t.type === 'expense' ? 'text-red-400' : 'text-green-400'}`}>{t.type === 'expense' ? '-' : '+'}₹{t.amount.toFixed(2)}</p>
                        <button onClick={() => handleOpenEditModal(t)} className="p-2 text-gray-500 hover:text-blue-400 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg></button>
                        <button onClick={() => setTransactionToDelete(t)} className="p-2 text-gray-500 hover:text-red-400 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg></button>
                      </div>
                    </div>
                ))}
              </div>
            </div>
          </div>
        </main>
        
        {/* Modals & Popups */}
        {editingTransaction && (
            <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
              <div className="bg-cred-dark p-6 rounded-2xl shadow-lg w-full max-w-md border border-cred-dark">
                <h2 className="text-2xl font-bold text-white mb-6">edit transaction</h2>
                <form onSubmit={handleUpdateTransaction} className="space-y-4">
                    <input type="number" value={editFormState.amount} onChange={e => setEditFormState(s=>({...s, amount: e.target.value}))} className="w-full input-cred p-3 rounded-lg"/>
                    {editingTransaction.type === 'expense' ? (
                        <>
                            <select value={editFormState.category} onChange={e => setEditFormState(s=>({...s, category: e.target.value}))} className="w-full input-cred p-3 rounded-lg appearance-none">{CATEGORIES.map(c => <option className="bg-gray-800" key={c.value} value={c.value}>{c.label}</option>)}</select>
                            <input type="text" value={editFormState.reason} onChange={e => setEditFormState(s=>({...s, reason: e.target.value}))} className="w-full input-cred p-3 rounded-lg"/>
                        </>
                    ) : (
                        <input type="text" value={editFormState.source} onChange={e => setEditFormState(s=>({...s, source: e.target.value}))} className="w-full input-cred p-3 rounded-lg"/>
                    )}
                    <input type="date" value={editFormState.date} onChange={e => setEditFormState(s=>({...s, date: e.target.value}))} className="w-full input-cred p-3 rounded-lg"/>
                    <div className="flex justify-end space-x-4 pt-4">
                        <button type="button" onClick={() => setEditingTransaction(null)} className="bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-600">cancel</button>
                        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">save changes</button>
                    </div>
                </form>
              </div>
            </div>
        )}
        {transactionToDelete && (
            <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
                <div className="bg-cred-dark p-6 rounded-lg shadow-xl text-center border border-cred-dark">
                    <h3 className="text-lg font-bold text-white mb-4">confirm deletion</h3>
                    <p className="text-gray-300">are you sure you want to permanently delete this?</p>
                    <div className="mt-6 flex justify-center space-x-4">
                        <button onClick={handleDeleteTransaction} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">delete</button>
                        <button onClick={() => setTransactionToDelete(null)} className="bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-600">cancel</button>
                    </div>
                </div>
            </div>
        )}
        {showGandhi && (
          <div className="fixed bottom-5 right-5 z-50 animate-popup">
            <div className="bg-gray-800 border-2 border-purple-500 p-4 rounded-full shadow-2xl shadow-purple-500/50">
              <svg width="100" height="100" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="70" fill="#FDE68A" /><path d="M 80 40 C 90 30, 110 30, 120 40" fill="none" stroke="#FFF" strokeWidth="4" strokeLinecap="round" /><path d="M 30 90 C 20 100, 20 120, 30 130" fill="#FDE68A" stroke="#4A5568" strokeWidth="3" /><path d="M 170 90 C 180 100, 180 120, 170 130" fill="#FDE68A" stroke="#4A5568" strokeWidth="3" /><rect x="55" y="80" width="40" height="20" rx="10" fill="black" /><rect x="105" y="80" width="40" height="20" rx="10" fill="black" /><line x1="95" y1="85" x2="105" y2="85" stroke="black" strokeWidth="3" /><path d="M 80 130 Q 100 145, 120 130" fill="none" stroke="#4A5568" strokeWidth="4" strokeLinecap="round" /><g transform="translate(130, 110) rotate(20)"><path d="M 0 20 C -10 20, -10 0, 0 0 L 10 0 C 25 0, 25 20, 10 20 Z" fill="#FDE68A" stroke="#4A5568" strokeWidth="3" /><path d="M 10 0 L 10 -15 C 10 -25, 25 -25, 25 -15 L 25 0 Z" fill="#FDE68A" stroke="#4A5568" strokeWidth="3" /></g></svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
