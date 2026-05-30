"""机器学习策略（FreqAI 风格）"""
from vnpy.trader.object import BarData
from strategies.base import RiskStrategy
import numpy as np


class MlStrategy(RiskStrategy):
    """基于技术指标特征的 ML 分类策略

    特征工程：MA 比率 / RSI / 波动率 / ATR
    模型：加权 K 近邻分类（纯 numpy，无 sklearn 依赖）
    信号：预测未来 N 日涨跌方向
    """

    train_window: int = 120     # 训练窗口
    predict_window: int = 5     # 预测窗口（未来N日涨跌）
    retrain_interval: int = 20  # 每 N 天重新训练
    confidence_threshold: float = 0.55  # 置信度阈值

    parameters = ["train_window", "predict_window", "retrain_interval", "confidence_threshold"] + RiskStrategy.risk_parameters

    def on_init(self):
        self.load_bar(max(self.train_window, 50))
        self.model = None
        self.last_train_bar = 0

    def on_start(self):
        pass

    def _compute_features(self, close, high, low):
        """批量计算技术指标特征矩阵"""
        n = len(close)
        features = []

        # MA 比率特征
        for w in [5, 10, 20]:
            ma = np.convolve(close, np.ones(w)/w, mode='full')[:n]
            ma[:w-1] = close[:w-1]  # 填充
            ratio = close / np.where(ma > 0, ma, 1) - 1
            features.append(ratio)

        # RSI
        deltas = np.diff(close, prepend=close[0])
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = np.convolve(gains, np.ones(14)/14, mode='full')[:n]
        avg_loss = np.convolve(losses, np.ones(14)/14, mode='full')[:n]
        rs = np.zeros(n)
        nonzero = avg_loss > 0
        rs[nonzero] = avg_gain[nonzero] / avg_loss[nonzero]
        rs[~nonzero] = 100.0
        rsi = 1 - 1 / (1 + rs)
        features.append(rsi)

        # 波动率
        returns = np.diff(close, prepend=close[0]) / np.where(close > 0, close, 1)
        vol = np.array([np.std(returns[max(0,i-20):i+1]) if i >= 5 else 0 for i in range(n)])
        features.append(vol)

        # ATR 比率
        tr = np.maximum(high - low, np.abs(np.diff(close, prepend=close[0])))
        atr = np.convolve(tr, np.ones(14)/14, mode='full')[:n]
        atr_ratio = atr / np.where(close > 0, close, 1)
        features.append(atr_ratio)

        return np.column_stack(features)

    def _knn_predict(self, X_train, y_train, x_new, k=15):
        """加权 K 近邻预测"""
        if len(X_train) < k:
            return 0.5

        dists = np.sqrt(np.sum((X_train - x_new) ** 2, axis=1))
        nearest_idx = np.argsort(dists)[:k]
        nearest_labels = y_train[nearest_idx]
        weights = 1 / (dists[nearest_idx] + 1e-8)
        return np.average(nearest_labels, weights=weights)

    def on_bar(self, bar: BarData):
        am = self.am
        am.update_bar(bar)
        if not am.inited:
            return

        if self.check_risk(bar):
            return

        bar_count = len(am.close)
        if bar_count < self.train_window + self.predict_window + 10:
            return

        # 定期重新训练
        if bar_count - self.last_train_bar >= self.retrain_interval or self.model is None:
            self.last_train_bar = bar_count
            try:
                self._train(am)
            except Exception:
                return

        if self.model is None:
            return

        # 当前特征
        close = np.array(am.close, dtype=float)
        high = np.array(am.high, dtype=float)
        low = np.array(am.low, dtype=float)
        feat = self._compute_features(close, high, low)
        x_new = feat[-1].reshape(1, -1)

        prob = self._knn_predict(self.model["X"], self.model["y"], x_new)

        if prob > self.confidence_threshold and self.pos == 0:
            self.buy_with_risk(bar.close_price)
        elif prob < (1 - self.confidence_threshold) and self.pos > 0:
            self.sell_with_risk(bar.close_price)

        self.put_event()

    def _train(self, am):
        """训练模型"""
        close = np.array(am.close, dtype=float)
        high = np.array(am.high, dtype=float)
        low = np.array(am.low, dtype=float)

        # 批量计算特征
        all_features = self._compute_features(close, high, low)

        # 构建训练集（跳过最后 predict_window 行，因为没有未来标签）
        n = len(close)
        X_list, y_list = [], []
        for i in range(self.train_window, n - self.predict_window):
            X_list.append(all_features[i])
            future_ret = (close[i + self.predict_window] - close[i]) / close[i]
            y_list.append(1 if future_ret > 0 else 0)

        if len(X_list) < 20:
            return

        self.model = {
            "X": np.array(X_list),
            "y": np.array(y_list),
        }
