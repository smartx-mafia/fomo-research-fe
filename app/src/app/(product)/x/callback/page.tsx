import {XBindScreen} from '@/components/XBindScreen';

/** X OAuth 自动回调落地页。路径必须与后端 x.redirect_uri 及 X 后台登记一致。 */
export default function XCallbackRoute() {
  return <XBindScreen />;
}
