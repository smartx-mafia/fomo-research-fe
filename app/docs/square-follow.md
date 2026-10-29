# Square 作者关注

在每张 Opinion 卡片的作者区域展示 Follow / Following；点击 Following 取消关注。
同一作者的卡片及各Lane共用一份状态，自己的卡片不显示该按钮。

- 使用 `/v1/social/relations/batch` 批量读取作者的 following 和私有 remark，每批最多100个identifier；按返回identifier对齐，不按数组位置猜测。
- 关注调用 POST `/v1/social/follows`，取消关注调用 POST `/v1/social/follows/delete`；body固定 `target_type=user` 与作者的 `target_id`。
- 写入期间同作者的所有按钮进入Saving，禁止重复提交；以响应中的following为准，不在响应前假装成功。
- 初始关系未知显示Checking，失败显示Retry status。写入结果不明确时先重新查询关系，不盲目重复写入。
- 未登录点击Follow提示登录；400000清理过期会话，430114提示邀请准入。
- 每次关注变动使Friends和Newest的旧游标、锚点和读取请求失效；Newest会补入关注用户的买入，因此重新读取其候选集合。已确认取消关注时移除Friends中该作者的卡片。
- Newest含公共成交≥$1000及我关注的平台用户买入≥$1，两者由后端去重；其他卖出和聪明钱规则不变。JWT变化立即清空Newest，避免刷新失败时保留旧账号的关注买入。
- JWT改变即隔离关系与备注；旧请求即使晚返回也不能更新新账号。取消关注不删除私有备注。
- 手动刷新Feed同时刷新作者关系，读取失败不能当作未关注。

入口实现：`SquareFeed` + `SquareOpinionCard`；状态与请求编排：`useSquareAuthorRelations`。
回归测试覆盖共享作者状态、关注/取关、重复点击、网络结果未知后的读回、换账号隔离、本人隐藏、未登录提示和Friends缓存更新。
