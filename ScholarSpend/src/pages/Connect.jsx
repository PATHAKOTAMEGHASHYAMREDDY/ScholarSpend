import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import '../styles/Connect.css';
import connectImage from '../assets/splitting.jpg';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

function Connect() {
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState(null);
  const [groups, setGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [splits, setSplits] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showChart, setShowChart] = useState(false);
  const [balances, setBalances] = useState({});

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          setError('Please authenticate to access this page');
          navigate('/authenticate');
          return;
        }

        const [profileRes, groupsRes] = await Promise.all([
          axios.get(`${import.meta.env.VITE_API_URL}/api/restapi/profile`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get(`${import.meta.env.VITE_API_URL}/api/connect/groups`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        setUserProfile(profileRes.data);
        setGroups(groupsRes.data.groups || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load data');
        if (err.response?.status === 401 || err.response?.status === 403) {
          localStorage.removeItem('token');
          navigate('/authenticate');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [navigate]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) {
      setError('Please enter a search query');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/connect/search-users`,
        { query: searchQuery },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSearchResults(response.data.users);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to search users');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!groupName || selectedMembers.length === 0) {
      setError('Group name and at least one member are required');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/connect/groups`,
        { name: groupName, memberIds: selectedMembers },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGroups([...groups, response.data.group]);
      setGroupName('');
      setSelectedMembers([]);
      setSearchResults([]);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!selectedGroup || !expenseDesc || !expenseAmount || Object.keys(splits).length === 0) {
      setError('Please fill all fields and select a group');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const totalSplit = Object.values(splits).reduce((sum, val) => sum + parseFloat(val || 0), 0);
      const amount = parseFloat(expenseAmount);
      if (totalSplit !== amount) {
        setError(`Split amounts (₹${totalSplit.toFixed(2)}) must equal total expense amount (₹${amount.toFixed(2)})`);
        setLoading(false);
        return;
      }

      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/connect/groups/${selectedGroup._id}/expenses`,
        { description: expenseDesc, amount: expenseAmount, splits },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setGroups(groups.map((g) => (g._id === selectedGroup._id ? response.data.group : g)));
      setSelectedGroup(response.data.group);
      setExpenseDesc('');
      setExpenseAmount('');
      setSplits({});
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!selectedGroup) {
      setError('Please select a group to finalize');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/connect/groups/${selectedGroup._id}/finalize`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGroups(groups.map((g) => (g._id === selectedGroup._id ? response.data.group : g)));
      setSelectedGroup(response.data.group);
      setBalances(response.data.balances);
      setShowChart(true);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to finalize group');
    } finally {
      setLoading(false);
    }
  };

  const handleSplitDone = async () => {
    if (!selectedGroup) {
      setError('Please select a group to close');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/connect/groups/${selectedGroup._id}/split-done`,
        { chartData: getChartData() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGroups(groups.map((g) => (g._id === selectedGroup._id ? response.data.group : g)));
      setSelectedGroup(response.data.group); // Keep selected to show chart
      setShowChart(true); // Ensure chart remains visible
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to close group');
    } finally {
      setLoading(false);
    }
  };

  const getChartData = () => {
    if (!selectedGroup || !selectedGroup.expenses.length) return [];
    const memberTotals = {};
    selectedGroup.expenses.forEach((exp) => {
      exp.splits.forEach((split) => {
        memberTotals[split.user.username] = (memberTotals[split.user.username] || 0) + split.amount;
      });
    });
    return Object.entries(memberTotals).map(([name, value]) => ({ name, value }));
  };

  const COLORS = ['#0077B5', '#00A0DC', '#38bdf8', '#1e3a8a', '#666D78'];

  const isOwner = selectedGroup && userProfile && selectedGroup.owner && selectedGroup.owner._id && userProfile._id &&
    selectedGroup.owner._id.toString() === userProfile._id.toString();

  if (loading) {
    return (
      <div className="connect-container">
        <div className="connect-loader">
          <div className="spinner"></div>
          <p>Loading your groups...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="connect-container">
      <h2>Connect & Split Expenses</h2>
      <div className="connect-main">
        <div className="left-section">
          <div className="connect-image-container">
            <img src={connectImage} alt="Connect and Split" className="connect-image" />
          </div>
          <div className="group-section">
            <h3>Create a Group</h3>
            <form onSubmit={handleCreateGroup}>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group Name"
                required
                disabled={loading}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by email or username"
                disabled={loading}
              />
              <button type="button" onClick={handleSearch} disabled={loading}>
                Search
              </button>
              <ul className="search-results">
                {searchResults.map((user) => (
                  <li key={user._id}>
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(user._id)}
                      onChange={() =>
                        setSelectedMembers(
                          selectedMembers.includes(user._id)
                            ? selectedMembers.filter((id) => id !== user._id)
                            : [...selectedMembers, user._id]
                        )
                      }
                      disabled={loading}
                    />
                    {user.username} ({user.email})
                  </li>
                ))}
              </ul>
              <button type="submit" disabled={loading}>
                Create Group
              </button>
            </form>
          </div>
        </div>
        <div className="right-section">
          {userProfile && (
            <div className="profile-summary">
              <h3>Welcome, {userProfile.username}</h3>
              <p>Email: {userProfile.email}</p>
            </div>
          )}
          {error && (
            <div className="error">
              {error}
              {error.includes('authenticate') && (
                <button onClick={() => navigate('/authenticate')}>Go to Authenticate</button>
              )}
            </div>
          )}
          <div className="group-list">
            <h3>Your Groups</h3>
            <select
              onChange={(e) => {
                setSelectedGroup(groups.find((g) => g._id === e.target.value) || null);
                setShowChart(false);
                setBalances({});
              }}
              disabled={loading}
            >
              <option value="">Select a Group</option>
              {groups.map((group) => (
                <option key={group._id} value={group._id}>
                  {group.name} {group.isClosed ? '(Closed)' : group.isFinalized ? '(Finalized)' : ''}
                </option>
              ))}
            </select>
          </div>
          {selectedGroup && (
            <div className="group-details">
              <h4>{selectedGroup.name}</h4>
              <p>Members: {selectedGroup.members.map((m) => m.username).join(', ')}</p>
              <h5>Expenses:</h5>
              <ul>
                {selectedGroup.expenses.map((exp, idx) => (
                  <li key={idx}>
                    {exp.description}: ₹{exp.amount} (Paid by: {exp.paidBy.username})
                    <ul>
                      {exp.splits.map((split, i) => (
                        <li key={i}>
                          {split.user.username}: ₹{split.amount.toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {!selectedGroup.isClosed && (
                <div className="expense-section">
                  <h5>Add New Expense</h5>
                  <form onSubmit={handleAddExpense}>
                    <input
                      type="text"
                      value={expenseDesc}
                      onChange={(e) => setExpenseDesc(e.target.value)}
                      placeholder="Expense Description"
                      required
                      disabled={loading || selectedGroup.isFinalized}
                    />
                    <input
                      type="number"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      placeholder="Total Amount (₹)"
                      min="0"
                      step="0.01"
                      required
                      disabled={loading || selectedGroup.isFinalized}
                    />
                    <h6>Split Expense</h6>
                    {selectedGroup.members.map((member) => (
                      <div key={member._id} className="split-input">
                        <label>{member.username}:</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={splits[member._id] || ''}
                          onChange={(e) =>
                            setSplits({ ...splits, [member._id]: e.target.value })
                          }
                          placeholder="Amount (₹)"
                          disabled={loading || selectedGroup.isFinalized}
                        />
                      </div>
                    ))}
                    <div className="button-group">
                      <button type="submit" disabled={loading || selectedGroup.isFinalized}>
                        {loading ? 'Processing...' : 'Add & Split Expense'}
                      </button>
                      {isOwner && selectedGroup.isFinalized && !selectedGroup.isClosed && (
                        <button
                          type="button"
                          className="split-done-btn"
                          onClick={handleSplitDone}
                          disabled={loading}
                        >
                          Split Done
                        </button>
                      )}
                    </div>
                  </form>
                  {isOwner && !selectedGroup.isFinalized && !selectedGroup.isClosed && (
                    <button className="done-btn" onClick={handleFinalize} disabled={loading}>
                      Finalize Group
                    </button>
                  )}
                </div>
              )}
              {(selectedGroup.isFinalized || selectedGroup.isClosed) && (
                <div className="summary-section">
                  <h5>Expense Summary</h5>
                  <p>Total Spent: ₹{selectedGroup.expenses.reduce((sum, exp) => sum + exp.amount, 0).toFixed(2)}</p>
                  {selectedGroup.expenses.length > 0 && (
                    <>
                      <PieChart width={400} height={400}>
                        <Pie
                          data={getChartData()}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        >
                          {getChartData().map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                      <h5>Balances</h5>
                      <ul className="balance-list">
                        {Object.entries(balances).map(([fromTo, amount]) => (
                          <li key={fromTo}>
                            {fromTo.split(' owes ').join(' owes ')}: ₹{amount.toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {selectedGroup.isClosed && <p>Group Closed: No further actions available.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <button className="back-btn" onClick={() => navigate('/userhome')} disabled={loading}>
        Back to Home
      </button>
    </div>
  );
}

export default Connect;