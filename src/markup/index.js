// Page markup, one file per page/section. Concatenated in this order into one document.
import p0 from './shell.html?raw';
import p1 from './home.html?raw';
import p2 from './about.html?raw';
import p3 from './tracker.html?raw';
import p4 from './profile.html?raw';
import p5 from './report.html?raw';
import p6 from './how-it-works.html?raw';
import p7 from './login.html?raw';
import p8 from './account.html?raw';
import p9 from './restaurants.html?raw';
import p10 from './dashboard.html?raw';
import p11 from './admin.html?raw';
import p12 from './footer.html?raw';
import p13 from './bot.html?raw';
import logoMark from '../assets/platewatch-logo-mark.webp';

export const markup = [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13]
  .join('\n')
  .replace('__LOGO__', logoMark);
