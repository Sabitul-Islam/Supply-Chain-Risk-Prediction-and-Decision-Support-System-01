import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Overview from './pages/Overview.jsx'
import DecisionSupport from './pages/DecisionSupport.jsx'
import Procurement from './pages/Procurement.jsx'
import PurchaseOrders from './pages/PurchaseOrders.jsx'
import Production from './pages/Production.jsx'
import Orders from './pages/Orders.jsx'
import Inventory from './pages/Inventory.jsx'
import Transportation from './pages/Transportation.jsx'
import Returns from './pages/Returns.jsx'
import Demand from './pages/Demand.jsx'
import Assistant from './pages/Assistant.jsx'
import History from './pages/History.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Overview />} />
        <Route path="/decision" element={<DecisionSupport />} />
        <Route path="/procurement" element={<Procurement />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/production" element={<Production />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/transportation" element={<Transportation />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/demand" element={<Demand />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/history" element={<History />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
