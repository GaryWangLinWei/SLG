import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { DevicePage } from './pages/Device';
import { PluginsPage } from './pages/Plugins';
import { TasksPage } from './pages/Tasks';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-900 text-white">
        <nav className="bg-gray-800 p-4">
          <div className="container mx-auto flex gap-6">
            <Link to="/" className="text-xl font-bold text-blue-400">SLG 自动化框架</Link>
            <Link to="/device" className="hover:text-blue-400">设备管理</Link>
            <Link to="/plugins" className="hover:text-blue-400">插件管理</Link>
            <Link to="/tasks" className="hover:text-blue-400">任务中心</Link>
          </div>
        </nav>

        <main className="container mx-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/device" element={<DevicePage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

function Dashboard() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">仪表盘</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">设备状态</h3>
          <p className="text-gray-400">未连接</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">可用插件</h3>
          <p className="text-gray-400">1 个</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">运行任务</h3>
          <p className="text-gray-400">0 个</p>
        </div>
      </div>
    </div>
  );
}


export default App;
