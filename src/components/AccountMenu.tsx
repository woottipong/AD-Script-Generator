import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { cn } from 'cn';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** One letter for the avatar. A Thai name skips its leading vowel (เ แ โ ใ ไ), so "เอกชัย" shows "อ". */
function initialOf(name: string | undefined, email: string): string {
  return (name?.trim() || email).replace(/^[เแโใไ]/, '').charAt(0).toLocaleUpperCase('th-TH');
}

/** Thai consonants have no ascender, so a centred Thai initial reads about 0.1em low beside Latin ones. */
const THAI_INITIAL = /^[\u0E00-\u0E7F]/;

/** The signed-in Author's name, email, and access, and the way to sign out. */
export function AccountMenu({ email, name, allJobs, accessGroups, onSignOut }: {
  email: string;
  name?: string;
  allJobs: boolean;
  accessGroups?: string[];
  onSignOut: () => void;
}) {
  const initial = initialOf(name, email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={`บัญชี ${email}`}
            // A round target with no square hover plate; hover and open deepen the avatar's own tint instead.
            className="group/account size-10 shrink-0 rounded-full not-disabled:hover:bg-transparent aria-expanded:bg-transparent pointer-coarse:size-11"
          />
        )}
      >
        <Avatar aria-hidden="true" size="lg" className="after:border-brand-200">
          <AvatarFallback
            className={cn(
              'bg-brand-100 text-base font-semibold text-brand-900 transition-colors duration-150 ease-out',
              'group-hover/account:bg-brand-200 group-aria-expanded/account:bg-brand-200',
            )}
          >
            <span className={THAI_INITIAL.test(initial) ? '-translate-y-[0.1em]' : undefined}>{initial}</span>
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5">
            {name && <span className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{name}</span>}
            <span className="truncate">{email}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {allJobs ? (
                <Badge variant="info"><ShieldCheck aria-hidden="true" />เห็นงานของทุกคน</Badge>
              ) : (
                <Badge variant="secondary"><UserRound aria-hidden="true" />เห็นเฉพาะงานของตัวเอง</Badge>
              )}
              {allJobs && accessGroups && accessGroups.length > 0 && (
                <span className="text-muted-foreground">กลุ่ม {accessGroups.join(', ')}</span>
              )}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}><LogOut aria-hidden="true" />ออกจากระบบ</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
