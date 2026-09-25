/**
 * Element Plus 风格轻量级全功能日期选择器 (ElDatePicker)
 * 100% 像素级复刻 Element Plus el-date-picker 交互与视觉
 * 特色：支持有数据日期全景涂色标记 (has-data highlight)
 */

(function () {
  let activePicker = null;
  let activeInput = null;
  let currentOptions = {};

  // 全局缓存的系统有数据交易日集合 (跨模块共享)
  window._allSystemTradingDates = window._allSystemTradingDates || new Set();

  // 异步预拉取系统所有有数据日期 (包含复盘交易日与全真模拟盘快照日)
  function preloadSystemAvailableDates() {
    try {
      const token = (typeof window.getToken === 'function' ? window.getToken() : null)
        || localStorage.getItem('quant_token')
        || localStorage.getItem('token')
        || localStorage.getItem('auth_token')
        || '';

      // 未登录且没有 token 时，不发起未授权请求，等待登录成功后由回调触发
      if (!token && typeof window.authFetch !== 'function') {
        return;
      }

      const getHeaders = () => token ? { 'Authorization': `Bearer ${token}` } : {};
      const doFetch = typeof window.authFetch === 'function' ? window.authFetch : (url, opt = {}) => {
        opt.headers = Object.assign({}, getHeaders(), opt.headers || {});
        return fetch(url, opt);
      };

      doFetch('/api/review/available-dates')
        .then(res => {
          if (!res.ok) return null;
          return res.json();
        })
        .then(json => {
          if (json && json.code === 200 && Array.isArray(json.data)) {
            json.data.forEach(d => window._allSystemTradingDates.add(d));
            window._availableWatchDates = json.data;
          }
        }).catch(err => { console.warn('preload available-dates fetch warn:', err); });
      
      doFetch('/api/paper-portfolio/history')
        .then(res => {
          if (!res.ok) return null;
          return res.json();
        })
        .then(json => {
          if (json && json.code === 200 && json.data && Array.isArray(json.data.available_dates)) {
            json.data.available_dates.forEach(d => window._allSystemTradingDates.add(d));
            window._paperAvailableDates = json.data.available_dates;
          }
        }).catch(err => { console.warn('preload trading dates fetch warn:', err); });
    } catch(e) { console.warn('preloadSystemAvailableDates warn:', e); }
  }
  preloadSystemAvailableDates();
  window.preloadSystemAvailableDates = preloadSystemAvailableDates;

  // 解析当前输入框或选项关联的【有数据日期列表】
  function resolveHasDataDates(inputEl, options) {
    const datesSet = new Set();
    const opts = options || currentOptions || {};

    // 1. 优先使用显式传入的 availableDates / hasDataDates
    const explicitDates = opts.availableDates || opts.hasDataDates;
    if (Array.isArray(explicitDates) && explicitDates.length > 0) {
      explicitDates.forEach(d => datesSet.add(d));
      return datesSet;
    }

    // 2. 检查元素自身属性 data-available-dates
    if (inputEl && inputEl.getAttribute) {
      const attrVal = inputEl.getAttribute('data-available-dates');
      if (attrVal) {
        try {
          const parsed = JSON.parse(attrVal);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed.forEach(d => datesSet.add(d));
            return datesSet;
          }
        } catch(e) {
          attrVal.split(',').map(s => s.trim()).filter(Boolean).forEach(d => datesSet.add(d));
          if (datesSet.size > 0) return datesSet;
        }
      }
    }

    // 3. 上下文推断：如果是模拟盘相关组件
    const inputId = (inputEl && inputEl.id) || '';
    if (inputId.includes('paper') || (inputEl && inputEl.closest && inputEl.closest('#paperPortfolioModule, #paperSnapshotDatePicker'))) {
      if (Array.isArray(window._paperAvailableDates) && window._paperAvailableDates.length > 0) {
        window._paperAvailableDates.forEach(d => datesSet.add(d));
        return datesSet;
      }
    }

    // 4. 上下文推断：如果是复盘/观察池相关组件
    if (inputId.includes('rw') || inputId.includes('watch') || inputId.includes('review')) {
      if (Array.isArray(window._availableWatchDates) && window._availableWatchDates.length > 0) {
        window._availableWatchDates.forEach(d => datesSet.add(d));
        return datesSet;
      }
    }

    // 5. 兜底策略：使用全系统全局已加载的有数据交易日缓存
    if (window._allSystemTradingDates && window._allSystemTradingDates.size > 0) {
      return window._allSystemTradingDates;
    }

    // 6. 动态推算最近 15 个工作日保底 (防网络异步延迟首屏空窗，彻底告别写死静态历史日期)
    const now = new Date();
    for (let i = 0; i < 30 && datesSet.size < 15; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        datesSet.add(`${yyyy}-${mm}-${dd}`);
      }
    }
    return datesSet;
  }

  // 创建全局日历浮层容器 (双重保险浅色白底 Element Plus 样式)
  function getOrCreatePickerEl() {
    let picker = document.getElementById('elCustomDatePickerPopup');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'elCustomDatePickerPopup';
      picker.className = 'el-date-picker-dropdown';
      picker.style.cssText = 'position:absolute;display:none;background:#ffffff !important;border:1px solid #e4e7ed !important;border-radius:8px !important;box-shadow:0 12px 32px 4px rgba(0,0,0,0.12),0 8px 20px rgba(0,0,0,0.06) !important;padding:14px 16px !important;z-index:100000 !important;width:316px !important;box-sizing:border-box !important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important;user-select:none !important;color:#303133 !important;';
      document.body.appendChild(picker);

      // 点击外部自动隐藏
      document.addEventListener('click', (e) => {
        if (!picker.contains(e.target) && activeInput && !activeInput.contains(e.target) && !e.target.closest('#btDateRangeWrapper, .el-date-editor')) {
          hidePicker();
        }
      });
    }
    return picker;
  }

  function hidePicker() {
    const picker = document.getElementById('elCustomDatePickerPopup');
    if (picker) picker.style.display = 'none';
    document.querySelectorAll('.el-date-editor.is-active, #btDateRangeWrapper.is-active').forEach(el => el.classList.remove('is-active'));
    activeInput = null;
    currentOptions = {};
  }

  /**
   * 渲染指定年月日的日历视图 (Element Plus 官方浅色规格 + 有数据日期涂色系统)
   */
  function renderCalendar(year, month, selectedDateStr, onSelectCallback, options) {
    const picker = getOrCreatePickerEl();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const hasDataDatesSet = resolveHasDataDates(activeInput, options);

    // 获取当月第一天是周几 (0-6)
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    // 获取当月总天数
    const daysInMonth = new Date(year, month, 0).getDate();
    // 获取上月总天数
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

    let html = `
      <div class="el-date-picker-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:2px 4px">
        <button type="button" class="el-picker-btn btn-d-prev" title="前一年" style="border:none;background:transparent;color:#909399;font-size:16px;font-weight:700;cursor:pointer;padding:2px 6px;border-radius:4px">&laquo;</button>
        <button type="button" class="el-picker-btn btn-prev" title="上个月" style="border:none;background:transparent;color:#909399;font-size:16px;font-weight:700;cursor:pointer;padding:2px 6px;border-radius:4px">&lsaquo;</button>
        <span class="el-date-picker-title" style="font-size:14px;font-weight:700;color:#303133;letter-spacing:0.5px">${year} 年 ${month} 月</span>
        <button type="button" class="el-picker-btn btn-next" title="下个月" style="border:none;background:transparent;color:#909399;font-size:16px;font-weight:700;cursor:pointer;padding:2px 6px;border-radius:4px">&rsaquo;</button>
        <button type="button" class="el-picker-btn btn-d-next" title="后一年" style="border:none;background:transparent;color:#909399;font-size:16px;font-weight:700;cursor:pointer;padding:2px 6px;border-radius:4px">&raquo;</button>
      </div>

      <table class="el-date-table" style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:4px">
        <thead>
          <tr>
            <th style="padding:6px 0;color:#909399;font-weight:500;border:none;border-bottom:1px solid #ebeef5;text-align:center">日</th>
            <th style="padding:6px 0;color:#909399;font-weight:500;border:none;border-bottom:1px solid #ebeef5;text-align:center">一</th>
            <th style="padding:6px 0;color:#909399;font-weight:500;border:none;border-bottom:1px solid #ebeef5;text-align:center">二</th>
            <th style="padding:6px 0;color:#909399;font-weight:500;border:none;border-bottom:1px solid #ebeef5;text-align:center">三</th>
            <th style="padding:6px 0;color:#909399;font-weight:500;border:none;border-bottom:1px solid #ebeef5;text-align:center">四</th>
            <th style="padding:6px 0;color:#909399;font-weight:500;border:none;border-bottom:1px solid #ebeef5;text-align:center">五</th>
            <th style="padding:6px 0;color:#909399;font-weight:500;border:none;border-bottom:1px solid #ebeef5;text-align:center">六</th>
          </tr>
        </thead>
        <tbody>
    `;

    let dayCounter = 1;
    let nextMonthDay = 1;

    for (let row = 0; row < 6; row++) {
      html += '<tr>';
      for (let col = 0; col < 7; col++) {
        if (row === 0 && col < firstDayOfWeek) {
          // 上个月的日期
          const prevDay = daysInPrevMonth - (firstDayOfWeek - col - 1);
          html += `<td class="prev-month" style="padding:3px 0;text-align:center"><span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;color:#c0c4cc;font-size:12.5px">${prevDay}</span></td>`;
        } else if (dayCounter <= daysInMonth) {
          // 当月日期
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayCounter).padStart(2, '0')}`;
          const isSelected = dateStr === selectedDateStr;
          const isToday = dateStr === todayStr;
          const isHasData = hasDataDatesSet.has(dateStr);

          let cellClass = 'available';
          let spanStyle = 'display:inline-flex;position:relative;flex-direction:column;align-items:center;justify-content:center;width:30px;height:30px;border-radius:6px;transition:all 0.15s cubic-bezier(0.4, 0, 0.2, 1);font-size:12.5px;box-sizing:border-box;cursor:pointer;';
          let titleAttr = '';
          let badgeDot = '';

          if (isSelected) {
            // 当前选中项：经典 Element Plus 激活高亮
            cellClass += ' is-selected';
            if (isHasData) cellClass += ' has-data';
            spanStyle += 'background:#409eff !important;color:#ffffff !important;font-weight:700;box-shadow:0 3px 10px rgba(64,158,255,0.45);';
            badgeDot = isHasData ? '<span style="position:absolute;bottom:2px;width:4px;height:4px;border-radius:50%;background:#ffffff;"></span>' : '';
            titleAttr = ` title="${dateStr} (当前选中)"`;
          } else if (isHasData) {
            // 【核心涂色】：有数据的交易日/快照日 显著涂色高亮 (浅蓝底色 + 边框 + 圆点)
            cellClass += ' has-data';
            spanStyle += 'background:#ecf5ff !important;border:1px solid #b3d8ff !important;color:#1677ff !important;font-weight:700;box-shadow:0 1px 3px rgba(64,158,255,0.12);';
            badgeDot = '<span style="position:absolute;bottom:2px;width:4px;height:4px;border-radius:50%;background:#409eff;"></span>';
            titleAttr = ` title="${dateStr} (该交易日有真实快照/复盘数据，点击查看)"`;
          } else if (isToday) {
            // 今天但无数据
            cellClass += ' is-today';
            spanStyle += 'color:#409eff;font-weight:700;border:1px solid #409eff;background:transparent;';
            titleAttr = ` title="${dateStr} (今日)"`;
          } else {
            // 普通无数据日期：柔和浅灰字、普通光标
            spanStyle += 'color:#909399;background:transparent;font-weight:normal;';
            titleAttr = ` title="${dateStr} (无交易数据)"`;
          }

          html += `<td class="${cellClass}" data-date="${dateStr}" data-has-data="${isHasData ? '1' : '0'}"${titleAttr} style="padding:3px 0;text-align:center"><span>${dayCounter}</span></td>`;
          dayCounter++;
        } else {
          // 下个月日期
          html += `<td class="next-month" style="padding:3px 0;text-align:center"><span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;color:#c0c4cc;font-size:12.5px">${nextMonthDay}</span></td>`;
          nextMonthDay++;
        }
      }
      html += '</tr>';
      if (dayCounter > daysInMonth && row >= 4) break;
    }

    html += `
        </tbody>
      </table>

      <!-- 底部操作与有数据图例说明 -->
      <div class="el-date-picker-footer" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid #ebeef5">
        <button type="button" class="el-picker-text-btn btn-clear" style="border:none;background:transparent;font-size:12px;font-weight:600;color:#909399;cursor:pointer;padding:3px 6px;border-radius:4px">清除</button>
        
        <!-- 精致有数据涂色图例 -->
        <div style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#0369a1;font-weight:600;background:#e0f2fe;padding:2px 8px;border-radius:10px;border:1px solid #bae6fd" title="日历上浅蓝色带圆点底色的日期均有真实量化/快照数据">
          <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#409eff"></span>
          涂色日期有数据
        </div>

        <button type="button" class="el-picker-text-btn btn-today" style="border:none;background:transparent;font-size:12px;font-weight:600;color:#409eff;cursor:pointer;padding:3px 6px;border-radius:4px">今天</button>
      </div>
    `;

    picker.innerHTML = html;

    // 绑定翻页事件
    picker.querySelector('.btn-d-prev').onclick = (e) => {
      e.stopPropagation();
      renderCalendar(year - 1, month, selectedDateStr, onSelectCallback, options);
    };
    picker.querySelector('.btn-prev').onclick = (e) => {
      e.stopPropagation();
      let newM = month - 1, newY = year;
      if (newM < 1) { newM = 12; newY--; }
      renderCalendar(newY, newM, selectedDateStr, onSelectCallback, options);
    };
    picker.querySelector('.btn-next').onclick = (e) => {
      e.stopPropagation();
      let newM = month + 1, newY = year;
      if (newM > 12) { newM = 1; newY++; }
      renderCalendar(newY, newM, selectedDateStr, onSelectCallback, options);
    };
    picker.querySelector('.btn-d-next').onclick = (e) => {
      e.stopPropagation();
      renderCalendar(year + 1, month, selectedDateStr, onSelectCallback, options);
    };

    // 绑定选中日期事件
    picker.querySelectorAll('td.available').forEach(td => {
      td.onclick = (e) => {
        e.stopPropagation();
        const d = td.getAttribute('data-date');
        if (onSelectCallback) onSelectCallback(d);
        hidePicker();
      };
      td.onmouseenter = () => {
        const span = td.querySelector('span');
        if (!span || td.classList.contains('is-selected')) return;
        
        if (td.classList.contains('has-data')) {
          // 有数据日期悬停高亮升级为深蓝强调
          span.style.background = '#409eff';
          span.style.color = '#ffffff';
          span.style.borderColor = '#409eff';
          span.style.boxShadow = '0 3px 8px rgba(64,158,255,0.35)';
          const dot = span.querySelector('span');
          if (dot) dot.style.background = '#ffffff';
        } else {
          span.style.background = '#f0f7ff';
          span.style.color = '#409eff';
        }
      };
      td.onmouseleave = () => {
        const span = td.querySelector('span');
        if (!span || td.classList.contains('is-selected')) return;

        if (td.classList.contains('has-data')) {
          // 恢复浅蓝涂色背景
          span.style.background = '#ecf5ff';
          span.style.color = '#1677ff';
          span.style.borderColor = '#b3d8ff';
          span.style.boxShadow = '0 1px 3px rgba(64,158,255,0.12)';
          const dot = span.querySelector('span');
          if (dot) dot.style.background = '#409eff';
        } else {
          span.style.background = 'transparent';
          span.style.color = td.classList.contains('is-today') ? '#409eff' : '#909399';
          span.style.boxShadow = 'none';
        }
      };
    });

    // 清除与今天
    picker.querySelector('.btn-clear').onclick = (e) => {
      e.stopPropagation();
      if (onSelectCallback) onSelectCallback('');
      hidePicker();
    };
    picker.querySelector('.btn-today').onclick = (e) => {
      e.stopPropagation();
      if (onSelectCallback) onSelectCallback(todayStr);
      hidePicker();
    };
  }

  /**
   * 打开指定输入框的 Element Plus 日历选择器
   * @param {HTMLElement} inputEl 触发的目标输入框
   * @param {Function} onSelectCallback 选中后的回调
   * @param {Object} options 扩展选项 (如 availableDates/hasDataDates)
   */
  function showDatePicker(inputEl, onSelectCallback, options) {
    if (!inputEl) return;
    activeInput = inputEl;
    currentOptions = options || {};
    const picker = getOrCreatePickerEl();

    // 激活对应外框样式
    document.querySelectorAll('.el-date-editor.is-active').forEach(el => el.classList.remove('is-active'));
    const container = inputEl.closest('.el-date-editor') || inputEl;
    if (container && container.classList) {
      container.classList.add('is-active');
    }

    let curVal = inputEl.value || inputEl.getAttribute('data-val') || '';
    let year, month;
    if (curVal && /^\d{4}-\d{2}-\d{2}$/.test(curVal)) {
      const parts = curVal.split('-');
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    renderCalendar(year, month, curVal, (selectedDate) => {
      inputEl.value = selectedDate;
      inputEl.setAttribute('data-val', selectedDate);
      if (typeof onSelectCallback === 'function') {
        onSelectCallback(selectedDate);
      }
      // 触发原生 change 事件
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }, currentOptions);

    // 计算弹窗绝对定位 (优先以外层卡片左边缘为基准)
    const targetRect = container.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    let popupLeft = targetRect.left + scrollLeft;
    // 防溢出右边界
    const pickerWidth = 316;
    if (popupLeft + pickerWidth > window.innerWidth - 10) {
      popupLeft = Math.max(10, window.innerWidth - pickerWidth - 16);
    }

    picker.style.position = 'absolute';
    picker.style.top = `${targetRect.bottom + scrollTop + 6}px`;
    picker.style.left = `${popupLeft}px`;
    picker.style.zIndex = '100000';
    picker.style.display = 'block';
  }

  // 挂载到全局
  window.ElDatePicker = {
    show: showDatePicker,
    hide: hidePicker,
    setAvailableDates: function (dates) {
      if (Array.isArray(dates)) {
        dates.forEach(d => window._allSystemTradingDates.add(d));
      }
    }
  };

  /**
   * 自动将全系统所有原生 date 控件绑定为 Element Plus 风格
   */
  window.initElDatePickers = function () {
    document.querySelectorAll('input[type="text"].el-date-input, input[type="date"].el-date-input').forEach(el => {
      if (el._elPickerInited) return;
      el._elPickerInited = true;
      el.setAttribute('readonly', 'readonly');
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        showDatePicker(el, (val) => {
          if (el.onchange) el.onchange();
        });
      });
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.initElDatePickers();
  });
})();
