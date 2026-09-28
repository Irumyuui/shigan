#define FOO
#if FOO
int live;
#elif false
int never;
#else
int dead;
#endif
