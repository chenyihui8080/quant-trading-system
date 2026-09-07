/**
 * Element Plus 风格轻量级全功能日期选择器 (ElDatePicker)
 * 100% 像素级复刻 Element Plus el-date-picker 交互与视觉
 */

(function () {
  let activePicker = null;
  let activeInput = null;

  // 创建全局日历浮层容器
  function getOrCreatePickerEl() {
    let picker = document.getElementById('elCustomDatePickerPopup');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'elCustomDatePickerPopup';
      picker.className = 'el-date-picker-dropdown';
      picker.style.display = 'none';
      document.body.appendChild(picker);

      // 点击外部自动隐藏
      document.addEventListener('click', (e) => {
        if (!picker.contains(e.target) && activeInput && !activeInput.contains(e.target)) {
          hidePicker();
        }
      });
    }
    return picker;
  }

  function hidePicker() {
    const picker = document.getElementById('elCustomDatePickerPopup');
    if (picker) picker.style.display = 'none';
    activeInput = null;
  }

  /**
   * 渲染指定年月日的日历视图
   */
  function renderCalendar(year, month, selectedDateStr, onSelectCallback) {
    const picker = getOrCreatePickerEl();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 获取当月第一天是周几 (0-6)
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    // 获取当月总天数
    const daysInMonth = new Date(year, month, 0).getDate();
    // 获取上月总天数
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

    let html = `
      <div class="el-date-picker-header">
        <button type="button" class="el-picker-btn btn-d-prev" title="前一年">&laquo;</button>
        <button type="button" class="el-picker-btn btn-prev" title="上个月">&lsaquo;</button>
        <span class="el-date-picker-title">${year} 年 ${month} 月</span>
        <button type="button" class="el-picker-btn btn-next" title="下个月">&rsaquo;</button>
        <button type="button" class="el-picker-btn btn-d-next" title="后一年">&raquo;</button>
      </div>

      <table class="el-date-table">
        <thead>
          <tr>
            <th>日</th><th>一</th><th>二</th><th>三</th><th>四</th><th>五</th><th>六</th>
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
          html += `<td class="prev-month">${prevDay}</td>`;
        } else if (dayCounter <= daysInMonth) {
          // 当月日期
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayCounter).padStart(2, '0')}`;
          const isSelected = dateStr === selectedDateStr;
          const isToday = dateStr === todayStr;

          let cellClass = 'available';
          if (isSelected) cellClass += ' is-selected';
          if (isToday) cellClass += ' is-today';

          html += `<td class="${cellClass}" data-date="${dateStr}"><span>${dayCounter}</span></td>`;
          dayCounter++;
        } else {
          // 下个月日期
          html += `<td class="next-month">${nextMonthDay}</td>`;
          nextMonthDay++;
        }
      }
      html += '</tr>';
      if (dayCounter > daysInMonth && row >= 4) break;
    }

    html += `
        </tbody>
      </table>

      <div class="el-date-picker-footer">
        <button type="button" class="el-picker-text-btn btn-clear">清除</button>
        <button type="button" class="el-picker-text-btn btn-today">今天</button>
      </div>
    `;

    picker.innerHTML = html;

    // 绑定翻页事件
    picker.querySelector('.btn-d-prev').onclick = (e) => {
      e.stopPropagation();
      renderCalendar(year - 1, month, selectedDateStr, onSelectCallback);
    };
    picker.querySelector('.btn-prev').onclick = (e) => {
      e.stopPropagation();
      let newM = month - 1, newY = year;
      if (newM < 1) { newM = 12; newY--; }
      renderCalendar(newY, newM, selectedDateStr, onSelectCallback);
    };
    picker.querySelector('.btn-next').onclick = (e) => {
      e.stopPropagation();
      let newM = month + 1, newY = year;
      if (newM > 12) { newM = 1; newY++; }
      renderCalendar(newY, newM, selectedDateStr, onSelectCallback);
    };
    picker.querySelector('.btn-d-next').onclick = (e) => {
      e.stopPropagation();
      renderCalendar(year + 1, month, selectedDateStr, onSelectCallback);
    };

    // 绑定选中日期事件
    picker.querySelectorAll('td.available').forEach(td => {
      td.onclick = (e) => {
        e.stopPropagation();
        const d = td.getAttribute('data-date');
        if (onSelectCallback) onSelectCallback(d);
        hidePicker();
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
   */
  function showDatePicker(inputEl, onSelectCallback) {
    activeInput = inputEl;
    const picker = getOrCreatePickerEl();

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
    });

    // 计算弹窗绝对定位
    const rect = inputEl.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    picker.style.position = 'absolute';
    picker.style.top = `${rect.bottom + scrollTop + 6}px`;
    picker.style.left = `${rect.left + scrollLeft}px`;
    picker.style.zIndex = '100000';
    picker.style.display = 'block';
  }

  // 挂载到全局
  window.ElDatePicker = {
    show: showDatePicker,
    hide: hidePicker
  };

  /**
   * 自动将全系统所有原生 date 控件绑定为 Element Plus 风格
   */
  window.initElDatePickers = function () {
    document.querySelectorAll('.el-date-editor, input[type="text"].el-date-input, input[type="date"].el-date-input').forEach(el => {
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
