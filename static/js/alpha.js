/**
 * ==================== 🎯 系统一：Alpha 决策工作台 (Trading Alpha Desk) 主调度入口 ====================
 * 
 * 架构说明：
 * 本文件作为系统一的前端主入口与生命周期总调度器。
 * 各大垂直业务域已解耦拆分至独立子模块（职责单一、低耦合）：
 *  1. alpha_calc.js       - 核心买卖点量化测算、子Tab切换、候选股扫描与推送
 *  2. alpha_sector.js     - 板块主力资金流动监控、成分股透视弹窗
 *  3. alpha_twitter.js    - 🐦 推特顶级博主实时情报雷达、中英双向翻译与重译
 *  4. alpha_eastmoney.js  - 🏦 东方财富实盘账户透视、Cookie 极速续期、持仓与自选
 *  5. alpha_prediction.js - 🎯 判断日记、AI 胜率复盘统计、每日实战作战计划
 */

/**
 * 初始化系统一：Alpha 决策工作台
 * 由系统切换器 system_switcher.js 或页面初始加载时统一调度
 */
async function initAlphaDesk() {
  try {
    // 1. 初始化核心买卖点测算与规则配置
    if (typeof window.initAlphaDeskCalc === 'function') {
      window.initAlphaDeskCalc();
    }

    // 2. 初始化东财实盘账户持仓与自选监控
    if (typeof window.loadPortfolioList === 'function') {
      window.loadPortfolioList();
    }

    // 3. 初始化板块与概念主力资金流动
    if (typeof window.loadSectorFlows === 'function') {
      window.loadSectorFlows();
    }

    // 4. 初始化推特顶级博主情报雷达
    if (typeof window.loadTwitterRadar === 'function') {
      window.loadTwitterRadar(false);
    }

    // 5. 初始化判断日记与胜率复盘统计
    if (typeof window.loadJudgeRecords === 'function') {
      window.loadJudgeRecords();
    }
    if (typeof window.loadJudgeStats === 'function') {
      window.loadJudgeStats();
    }
  } catch (err) {
    console.error('[AlphaDesk] 初始化系统一异常:', err);
  }
}

// 统一向全局挂载入口，兼容旧版 system_switcher 与外部模块引用
window.initAlphaDesk = initAlphaDesk;

// DOM 树构建完成后挂载安全调度
document.addEventListener('DOMContentLoaded', () => {
  const alphaContainer = document.getElementById('system_alpha');
  // 若当前页面直接展示系统一，则自动唤醒
  if (alphaContainer && alphaContainer.style.display !== 'none') {
    initAlphaDesk();
  }
});