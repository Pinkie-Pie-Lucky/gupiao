interface BubbleAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  online?: boolean;
  className?: string;
}

const SIZE_CLASS = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
};

export function BubbleAvatar({ size = 'md', online = false, className = '' }: BubbleAvatarProps) {
  return (
    <div className={`${SIZE_CLASS[size]} rounded-2xl bg-gradient-to-br from-indigo-50 to-sky-100 border border-indigo-100 shadow-inner flex items-center justify-center relative flex-shrink-0 ${className}`}>
      <svg viewBox="0 0 120 120" className="w-[74%] h-[74%]" role="img" aria-label="泡泡AI老师">
        <path d="M26 55a35 35 0 0 1 68 0" fill="none" stroke="#818CF8" strokeWidth="4.5" strokeLinecap="round" />
        <rect x="22" y="46" width="8" height="20" rx="4" fill="#4F46E5" />
        <rect x="90" y="46" width="8" height="20" rx="4" fill="#4F46E5" />
        <rect x="30" y="34" width="60" height="48" rx="24" fill="#FFFFFF" />
        <rect x="36" y="40" width="48" height="36" rx="18" fill="#1E1B4B" />
        <circle cx="48" cy="56" r="3.5" fill="#818CF8" />
        <circle cx="72" cy="56" r="3.5" fill="#818CF8" />
        <path d="M54 66q6 7 12 0" fill="none" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" />
        <circle cx="60" cy="18" r="4.5" fill="#F59E0B" />
        <line x1="60" y1="18" x2="60" y2="34" stroke="#CBD5E1" strokeWidth="2.5" />
      </svg>
      {online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />}
    </div>
  );
}
